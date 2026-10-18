const router = require('express').Router();
const mongoose = require('mongoose');
const { Alert, Block, Booking, Ping, User, Ledger, Withdrawal } = require('../models');
const { ah, auth, verified, limiter, byUser } = require('../middleware');
const { bad, isUpi, getSettings, firstName } = require('../util');
const { balanceOf, reverseWithdrawal } = require('../services');
const { notifyAdmins, sendSms } = require('../notify');

router.use(auth);
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? undefined : Number(v));
const inRange = (lat, lng) => lat === undefined || lng === undefined || (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180);

/** Builds the SOS text that goes to the admins (and the emergency contact). */
async function sosText(user, alert) {
  let line = '';
  if (alert.booking) {
    const b = await Booking.findById(alert.booking).select('service startsAt venueType venueName renterName companionName hours').lean();
    if (b) line = `\nBooking: ${b.service} with ${String(user._id) === String(alert.user) ? '' : ''}${b.renterName} and ${b.companionName}, ${new Date(b.startsAt).toLocaleString('en-IN')}, ${b.venueType} (${b.venueName}).`;
  }
  const loc = alert.lat !== undefined && alert.lat !== null ? `\nLocation: https://www.google.com/maps?q=${alert.lat},${alert.lng}` : '\nLocation: not available';
  return `SOS from ${user.name} (mobile ${user.mobile || '-'}).${line}${loc}\nEmergency contact: ${user.emergencyName || '-'} ${user.emergencyMobile || ''}\nTime: ${new Date().toLocaleString('en-IN')}`;
}

/* SOS: saved first, then REAL notifications go out (email/webhook to the admin team, SMS to the emergency contact if a gateway is set). */
router.post('/sos', limiter(60 * 1000, 4, 'SOS already sent. Help is being alerted. If you are in danger, call 112.', byUser), ah(async (req, res) => {
  const b = req.body || {};
  const lat = num(b.lat), lng = num(b.lng);
  if (!inRange(lat, lng)) bad('Bad location');
  let booking;
  if (mongoose.isValidObjectId(b.bookingId)) {
    const bk = await Booking.findOne({ _id: b.bookingId, $or: [{ renter: req.user._id }, { companion: req.user._id }] }).select('_id');
    booking = bk ? bk._id : undefined;
  }
  const a = await Alert.create({ user: req.user._id, booking, type: 'SOS', note: 'SOS pressed', lat, lng });
  res.json({ alert: { _id: a._id } });                       // answer the user immediately, notify in the background
  (async () => {
    const text = await sosText(req.user, a);
    const ok = await notifyAdmins('🚨 Yaari SOS: ' + firstName(req.user.name), text);
    await Alert.updateOne({ _id: a._id }, { $set: { notified: ok }, $inc: { notifyTries: 1 } });
    if (req.user.emergencyMobile) await sendSms(req.user.emergencyMobile, `${req.user.name} pressed the SOS button on Yaari and may need help.${lat !== undefined ? ` Location: https://www.google.com/maps?q=${lat},${lng}` : ''}`);
  })().catch((e) => console.error('SOS notification failed:', e.message));
}));

router.post('/report', limiter(60 * 60 * 1000, 20, 'Too many reports. Please try again later.', byUser), ah(async (req, res) => {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.reportedId) || String(b.reportedId) === String(req.user._id)) bad('User not found');
  if (!(await User.exists({ _id: b.reportedId }))) bad('User not found');
  if (typeof b.reason !== 'string' || b.reason.trim().length < 3) bad('Choose a reason');
  let booking;
  if (mongoose.isValidObjectId(b.bookingId)) { const bk = await Booking.findOne({ _id: b.bookingId, $or: [{ renter: req.user._id }, { companion: req.user._id }] }).select('_id'); booking = bk ? bk._id : undefined; }
  const a = await Alert.create({ user: req.user._id, booking, type: 'Report', reported: b.reportedId, note: (b.reason.trim() + ': ' + String(b.details || '').trim()).slice(0, 600) });
  notifyAdmins('Yaari: a user was reported', `${req.user.name} reported a person.\n${a.note}\n\nOpen the admin panel, Safety tab.`).then((ok) => Alert.updateOne({ _id: a._id }, { $set: { notified: ok } })).catch(() => {});
  res.json({ ok: true });
}));

router.post('/block', ah(async (req, res) => {
  const id = (req.body || {}).userId;
  if (!mongoose.isValidObjectId(id) || String(id) === String(req.user._id)) bad('User not found');
  await Block.updateOne({ blocker: req.user._id, blocked: id }, { $setOnInsert: {} }, { upsert: true });
  res.json({ ok: true });
}));

/* live location sharing while a meeting is on (the page must stay open) */
router.post('/ping', limiter(60 * 1000, 10, 'Too many location updates.', byUser), ah(async (req, res) => {
  const b = req.body || {}, lat = num(b.lat), lng = num(b.lng);
  if (!mongoose.isValidObjectId(b.bookingId) || lat === undefined || lng === undefined || !inRange(lat, lng)) bad('Bad location');
  const bk = await Booking.findOne({ _id: b.bookingId, status: { $in: ['accepted', 'in_progress'] }, $or: [{ renter: req.user._id }, { companion: req.user._id }] }).select('_id');
  if (!bk) bad('Booking not found', 404);
  await Ping.create({ booking: bk._id, user: req.user._id, lat, lng });
  res.json({ ok: true });
}));

/* wallet and withdrawals */
router.get('/wallet', ah(async (req, res) => {
  const [balance, ledger, withdrawals] = await Promise.all([
    balanceOf(req.user._id),
    Ledger.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).select('amount type note createdAt').lean(),
    Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20).select('amount upi status createdAt').lean(),
  ]);
  res.json({ balance, ledger, withdrawals });
}));

/* The whole balance is withdrawn. Only ONE pending withdrawal per person can exist (unique index), so a double tap
   can never pay out twice. Order: create the request (this takes the "slot"), then write the wallet debit. */
router.post('/withdraw', verified, limiter(60 * 60 * 1000, 10, 'Too many withdrawal attempts.', byUser), ah(async (req, res) => {
  const upi = String((req.body || {}).upi || '').trim();
  if (!isUpi(upi)) bad('Enter a valid UPI ID, like name@bank.');
  const s = await getSettings();
  const amount = await balanceOf(req.user._id);
  if (amount < s.minWithdrawal) bad(`Minimum withdrawal is ₹${s.minWithdrawal}`);
  let w;
  try { w = await Withdrawal.create({ user: req.user._id, amount, upi }); }
  catch (e) { if (e.code === 11000) bad('You already have a withdrawal waiting for payment. Wait until it is paid.', 409); throw e; }
  try {
    await Ledger.updateOne({ ref: w._id, type: 'withdrawal' }, { $setOnInsert: { user: req.user._id, amount: -amount, note: 'Withdrawal to ' + upi } }, { upsert: true });
  } catch (e) { await Withdrawal.deleteOne({ _id: w._id }); throw e; }
  notifyAdmins('Yaari: new withdrawal request', `${req.user.name} asked to withdraw ₹${amount} to ${upi}. Open the admin panel, Payments and payouts.`).catch(() => {});
  res.json({ withdrawal: { _id: w._id, amount, upi, status: w.status, createdAt: w.createdAt } });
}));

module.exports = router;
