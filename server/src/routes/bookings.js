const router = require('express').Router();
const mongoose = require('mongoose');
const cfg = require('../config');
const { Booking, User, Companion, Block, Review, Message, Alert } = require('../models');
const { tx } = require('../db');
const { ah, auth, verified, limiter, byUser } = require('../middleware');
const { bad, VENUES, istDay, getSettings, money, chatProblem, razorpay, firstName, overlaps, randomCode4 } = require('../util');
const { completeBooking, refundBooking } = require('../services');
const { notifyAdmins } = require('../notify');

router.use(auth);

const oid = (v) => (mongoose.isValidObjectId(v) ? v : bad('Not found', 404));
const HIDE = '-razorpayOrderId -razorpayPaymentId -extensions.orderId -extensions.paymentId'; // payment ids stay on the server
const ACTIVE = ['paid', 'accepted', 'in_progress'];
const MAX_DAYS_AHEAD = 120;

async function myBooking(req, { as = 'any' } = {}) {
  const b = await Booking.findById(oid(req.params.id));
  if (!b) bad('Booking not found', 404);
  const uid = String(req.user._id);
  const isR = String(b.renter) === uid, isC = String(b.companion) === uid;
  if (as === 'renter' && !isR) bad('Booking not found', 404);
  if (as === 'companion' && !isC) bad('Booking not found', 404);
  if (as === 'any' && !isR && !isC && !req.user.isAdmin) bad('Booking not found', 404);
  return b;
}

/** Another active booking of this companion that overlaps the time window. Runs inside the booking transaction. */
async function findClash(companionId, start, hours, session, ignoreId) {
  const end = new Date(+start + hours * 3600e3);
  const q = {
    companion: companionId, startsAt: { $lt: end },
    $or: [{ status: { $in: ACTIVE } }, { status: 'pending_payment', createdAt: { $gt: new Date(Date.now() - 15 * 60000) } }],
  };
  if (ignoreId) q._id = { $ne: ignoreId };
  const list = await Booking.find(q).select('startsAt hours').session(session);
  return list.some((x) => overlaps(x.startsAt, x.hours, start, hours));
}

/* ---------- create a booking (all checks and all money maths happen here) ---------- */
router.post('/', verified, limiter(60 * 60 * 1000, 40, 'Too many booking attempts. Please try again later.', byUser), ah(async (req, res) => {
  const b = req.body || {}, me = req.user;
  if (!me.avatar) bad('Please add your profile photo in the Account tab before booking.');
  if (!mongoose.isValidObjectId(b.companion)) bad('This companion is not available');
  if (String(b.companion) === String(me._id)) bad('You cannot book yourself');
  const comp = await User.findOne({ _id: b.companion, status: 'verified' });
  const cp = comp && await Companion.findOne({ user: comp._id, active: true });
  if (!comp || !cp) bad('This companion is not available');
  if (await Block.exists({ $or: [{ blocker: me._id, blocked: comp._id }, { blocker: comp._id, blocked: me._id }] })) bad('This companion is not available');

  const hours = Number(b.hours), start = new Date(b.startsAt);
  if (typeof b.service !== 'string' || !cp.services.includes(b.service)) bad('This service is not offered');
  if (b.service === 'Caretaker' && !cp.caretakerVerified) bad('Caretaker is not verified yet');
  if (!(VENUES[b.service] || []).includes(b.venueType)) bad('That venue type is not allowed for this service');
  if (!Number.isInteger(hours) || hours < 1 || hours > 4) bad('Choose 1 to 4 hours');
  if (isNaN(start) || start < new Date(Date.now() + 3600e3)) bad('Choose a time at least 1 hour from now');
  if (start > new Date(Date.now() + MAX_DAYS_AHEAD * 86400e3)) bad(`Bookings can be made up to ${MAX_DAYS_AHEAD} days ahead`);
  if (typeof b.venueName !== 'string' || b.venueName.trim().length < 3 || b.venueName.length > 100) bad('Enter the venue name');
  if (cp.days.length && !cp.days.includes(istDay(start))) bad(`This companion is not available on that day. Available: ${cp.days.join(', ')}`);

  const s = await getSettings();
  const m = money(cp.rate, hours, s);
  // The transaction first "touches" the companion (lockSeq). Two people booking the same companion at the same moment
  // now take turns, so the clash check always sees the other booking. (Needs MongoDB Atlas / a replica set.)
  const created = await tx(async (session) => {
    await Companion.updateOne({ user: comp._id }, { $inc: { lockSeq: 1 } }, { session });
    if (await findClash(comp._id, start, hours, session)) bad('This companion is already booked at that time. Please choose another time.');
    const [bk] = await Booking.create([{
      renter: me._id, companion: comp._id, renterName: firstName(me.name), companionName: firstName(comp.name),
      renterAvatar: me.avatar, companionAvatar: comp.avatar, service: b.service, hours, startsAt: start,
      venueType: b.venueType, venueName: b.venueName.trim(), rate: cp.rate, ...m, checkinCode: randomCode4(),
    }], { session });
    return bk;
  }, { required: true });
  const out = created.toObject(); delete out.checkinCode; delete out.razorpayOrderId; delete out.razorpayPaymentId;
  res.json({ booking: out });
}));

/* ---------- lists ---------- */
router.get('/mine', ah(async (req, res) => {
  const list = await Booking.find({ renter: req.user._id }).select(HIDE + ' +checkinCode').sort({ createdAt: -1 }).limit(200).lean();
  const reviews = await Review.find({ reviewer: req.user._id, booking: { $in: list.map((b) => b._id) } }).select('booking').lean();
  const done = new Set(reviews.map((r) => String(r.booking)));
  res.json({ list: list.map((b) => { const o = { ...b, reviewed: done.has(String(b._id)) }; if (!['paid', 'accepted'].includes(b.status)) delete o.checkinCode; return o; }) });
}));

router.get('/requests', ah(async (req, res) => {
  const list = await Booking.find({ companion: req.user._id, status: { $ne: 'pending_payment' } }).select(HIDE).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ list });
}));

/* ---------- paying ---------- */
/* One booking, one Razorpay order. If the order already exists it is re-used, so a payment can never be made
   against an order the booking has forgotten about (that would leave money received with no booking). */
router.post('/:id/pay-order', limiter(10 * 60 * 1000, 30, 'Too many payment attempts. Please wait a few minutes.', byUser), ah(async (req, res) => {
  const b = await myBooking(req, { as: 'renter' });
  if (b.status !== 'pending_payment') bad('This booking is not waiting for payment');
  if (b.razorpayOrderId) return res.json({ orderId: b.razorpayOrderId, amount: b.total * 100, keyId: cfg.rz.keyId });
  const order = await razorpay('/orders', { amount: b.total * 100, currency: 'INR', receipt: String(b._id), notes: { booking: String(b._id) } });
  const set = await Booking.updateOne({ _id: b._id, status: 'pending_payment', razorpayOrderId: { $in: [null, undefined] } }, { $set: { razorpayOrderId: order.id } });
  if (!set.modifiedCount) { const cur = await Booking.findById(b._id); if (cur && cur.razorpayOrderId) return res.json({ orderId: cur.razorpayOrderId, amount: cur.total * 100, keyId: cfg.rz.keyId }); bad('Please try again'); }
  res.json({ orderId: order.id, amount: order.amount, keyId: cfg.rz.keyId });
}));

router.post('/:id/cancel-unpaid', ah(async (req, res) => {
  const b = await myBooking(req, { as: 'renter' });
  await Booking.updateOne({ _id: b._id, status: 'pending_payment' }, { $set: { status: 'cancelled' } });
  res.json({ ok: true });
}));

router.post('/:id/refund', ah(async (req, res) => {
  await refundBooking(oid(req.params.id), req.user);
  res.json({ ok: true });
}));

/* ---------- the meeting ---------- */
router.post('/:id/accept', ah(async (req, res) => {
  const b = await myBooking(req, { as: 'companion' });
  const r = await Booking.updateOne({ _id: b._id, status: 'paid', startsAt: { $gt: new Date() } }, { $set: { status: 'accepted' } });
  if (!r.modifiedCount) bad('This request can no longer be accepted');
  res.json({ ok: true });
}));

/* Only 5 wrong codes are allowed per booking (a 4-digit code could otherwise be guessed). */
router.post('/:id/start', limiter(60 * 1000, 12, 'Too many tries. Please wait a minute.', byUser), ah(async (req, res) => {
  const b = await myBooking(req, { as: 'companion' });
  const code = String((req.body || {}).code || '').trim();
  const t = await Booking.findOneAndUpdate({ _id: b._id, status: 'accepted', startAttempts: { $lt: 5 } }, { $inc: { startAttempts: 1 } }, { new: true }).select('+checkinCode +startAttempts');
  if (!t) {
    const cur = await Booking.findById(b._id).select('status');
    if (cur && cur.status === 'accepted') bad('Too many wrong codes. Please contact Yaari support.', 429);
    bad('This booking cannot be started');
  }
  if (!/^\d{4}$/.test(code) || code !== t.checkinCode) bad(`Wrong check-in code (${5 - t.startAttempts} tries left)`);
  const r = await Booking.updateOne({ _id: b._id, status: 'accepted' }, { $set: { status: 'in_progress' } });
  if (!r.modifiedCount) bad('This booking cannot be started');
  res.json({ ok: true });
}));

router.post('/:id/complete', ah(async (req, res) => {
  const b = await myBooking(req, { as: 'renter' });
  const done = await completeBooking(b._id);
  if (!done) bad('The meeting has not started yet');
  res.json({ ok: true });
}));

router.post('/:id/problem', ah(async (req, res) => {
  const b = await myBooking(req, { as: 'renter' });
  const note = String((req.body || {}).note || '').trim();
  if (!['accepted', 'in_progress'].includes(b.status)) bad('You can report a problem only before the payment is released');
  if (note.length < 5) bad('Please describe the problem');
  const r = await Booking.updateOne({ _id: b._id, status: { $in: ['accepted', 'in_progress'] } }, { $set: { disputed: true, disputeNote: note.slice(0, 500) } });
  if (!r.modifiedCount) bad('You can report a problem only before the payment is released');
  const a = await Alert.create({ user: req.user._id, booking: b._id, type: 'Report', note: 'Problem with booking: ' + note.slice(0, 500), reported: b.companion });
  notifyAdmins('Yaari: problem reported on a booking', `${b.renterName} reported a problem with ${b.companionName} (${b.service}, ${new Date(b.startsAt).toLocaleString('en-IN')}).\n\n${note.slice(0, 500)}\n\nOpen the admin panel, Safety tab.`)
    .then((ok) => Alert.updateOne({ _id: a._id }, { $set: { notified: ok } })).catch(() => {});
  res.json({ ok: true });
}));

/* ---------- extra time during a meeting (paid separately, so the companion earns for every hour) ---------- */
router.post('/:id/extend', limiter(10 * 60 * 1000, 20, 'Too many attempts. Please wait a few minutes.', byUser), ah(async (req, res) => {
  const b = await myBooking(req, { as: 'renter' });
  const extra = Number((req.body || {}).extraHours);
  if (b.status !== 'in_progress') bad('You can add time only while the meeting is in progress');
  if (!Number.isInteger(extra) || extra < 1 || extra > 4) bad('Choose 1 to 4 extra hours');
  if (b.hours + extra > 12) bad('A booking can be at most 12 hours in total');
  const s = await getSettings();
  const m = money(b.rate, extra, s);

  const ext = await tx(async (session) => {
    await Companion.updateOne({ user: b.companion }, { $inc: { lockSeq: 1 } }, { session }); // same lock as new bookings
    const fresh = await Booking.findById(b._id).session(session);
    if (!fresh || fresh.status !== 'in_progress') bad('You can add time only while the meeting is in progress');
    if (fresh.hours + extra > 12) bad('A booking can be at most 12 hours in total');
    const startNew = new Date(+fresh.startsAt + fresh.hours * 3600e3);
    if (await findClash(fresh.companion, startNew, extra, session, fresh._id)) bad('The companion has another booking right after yours, so more time cannot be added.');
    await Booking.updateOne({ _id: b._id }, { $set: { 'extensions.$[p].status': 'cancelled' } }, { arrayFilters: [{ 'p.status': 'pending_payment' }], session });
    const updated = await Booking.findByIdAndUpdate(b._id, { $push: { extensions: { extraHours: extra, ...m } } }, { new: true, session });
    return updated.extensions[updated.extensions.length - 1];
  }, { required: true });

  const order = await razorpay('/orders', { amount: ext.total * 100, currency: 'INR', receipt: String(ext._id), notes: { extension: String(ext._id), booking: String(b._id) } });
  await Booking.updateOne({ _id: b._id, 'extensions._id': ext._id }, { $set: { 'extensions.$.orderId': order.id } });
  res.json({ orderId: order.id, amount: order.amount, keyId: cfg.rz.keyId });
}));

/* ---------- review (one per meeting; the companion's average is kept up to date) ---------- */
router.post('/:id/review', ah(async (req, res) => {
  const b = await myBooking(req, { as: 'renter' });
  const stars = Number((req.body || {}).stars);
  if (b.status !== 'completed') bad('You can review only after the meeting is completed');
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) bad('Choose 1 to 5 stars');
  try {
    await Review.create({ booking: b._id, reviewer: req.user._id, reviewee: b.companion, stars, comment: String((req.body || {}).comment || '').trim().slice(0, 300) });
  } catch (e) { if (e.code === 11000) bad('You already reviewed this meeting'); throw e; }
  await Companion.updateOne({ user: b.companion }, { $inc: { ratingSum: stars, ratingCount: 1 } });
  res.json({ ok: true });
}));

/* ---------- chat (only after a booking is confirmed; also readable by admins) ---------- */
router.get('/:id/messages', ah(async (req, res) => {
  const b = await myBooking(req);
  const q = { booking: b._id };
  if (req.query.after) { const d = new Date(String(req.query.after)); if (!isNaN(d)) q.createdAt = { $gt: d }; } // only new messages: much lighter on the database
  const list = await Message.find(q).sort({ createdAt: 1 }).limit(300).lean();
  res.json({ list });
}));

router.post('/:id/messages', limiter(60 * 1000, 40, 'You are sending messages too fast.', byUser), ah(async (req, res) => {
  const b = await myBooking(req);
  if (![String(b.renter), String(b.companion)].includes(String(req.user._id))) bad('Not allowed', 403);
  if (!['accepted', 'in_progress'].includes(b.status)) bad('Chat is available once the booking is confirmed');
  const body = String((req.body || {}).body || '').trim().slice(0, 500);
  if (!body) bad('Type a message first');
  const problem = chatProblem(body); if (problem) bad(problem);
  const m = await Message.create({ booking: b._id, sender: req.user._id, body });
  res.json({ message: m });
}));

module.exports = router;
