const router = require('express').Router();
const mongoose = require('mongoose');
const { User, Companion, Booking, Payment, Ledger, Withdrawal, Alert, Ping, Audit, File, Message, Settings, Review } = require('../models');
const { ah, auth, admin } = require('../middleware');
const { bad, getSettings } = require('../util');
const { completeBooking, refundBooking, reverseWithdrawal } = require('../services');

router.use(auth, admin);
const oid = (v) => (mongoose.isValidObjectId(v) ? v : bad('Not found', 404));
const log = (req, action, target) => Audit.create({ admin: req.user._id, action, target: String(target || '') });
const sum = (rows) => (rows.length ? rows[0].s : 0);

/* Totals are calculated by the database (correct even with thousands of records). Cheap enough to poll every 20 seconds. */
router.get('/stats', ah(async (req, res) => {
  const [users, comps, bStat, pStat, owed, wPend, openAlerts, openSos, platform, escrow, orphan] = await Promise.all([
    User.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Companion.countDocuments(),
    Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Payment.aggregate([{ $group: { _id: '$status', s: { $sum: '$amount' } } }]),
    Ledger.aggregate([{ $group: { _id: null, s: { $sum: '$amount' } } }]),
    Withdrawal.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, s: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    Alert.countDocuments({ status: 'open' }),
    Alert.countDocuments({ status: 'open', type: 'SOS' }),
    Booking.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, s: { $sum: { $add: ['$fee', '$commission'] } } } }]),
    Booking.aggregate([{ $match: { status: { $in: ['paid', 'accepted', 'in_progress'] } } }, { $group: { _id: null, s: { $sum: '$total' } } }]),
    Payment.countDocuments({ status: 'orphan' }),
  ]);
  const by = (rows, k = 'n') => Object.fromEntries(rows.map((r) => [r._id, r[k]]));
  res.json({
    users: by(users), companions: comps, bookings: by(bStat),
    collected: (by(pStat, 's').captured || 0) + (by(pStat, 's').refunding || 0), refunded: by(pStat, 's').refunded || 0,
    owed: sum(owed), platform: sum(platform), escrow: sum(escrow),
    payoutsPending: wPend.length ? wPend[0].s : 0, payoutsPendingCount: wPend.length ? wPend[0].n : 0,
    openAlerts, openSos, orphanPayments: orphan,
  });
}));

/* The lists for the screens (latest records only; use search/filters on the screen). */
router.get('/data', ah(async (req, res) => {
  const [users, comps, bookings, payments, withdrawals, alerts, pings, audit, settings] = await Promise.all([
    User.find().sort({ createdAt: -1 }).limit(500).lean(),
    Companion.find().select('-lockSeq').lean(),
    Booking.find().sort({ createdAt: -1 }).limit(500).lean(),
    Payment.find().sort({ createdAt: -1 }).limit(300).lean(),
    Withdrawal.find().sort({ createdAt: -1 }).limit(300).lean(),
    Alert.find().sort({ createdAt: -1 }).limit(200).lean(),
    Ping.find().sort({ createdAt: -1 }).limit(300).lean(),
    Audit.find().sort({ createdAt: -1 }).limit(25).lean(),
    getSettings(),
  ]);
  res.json({
    users, companions: comps, bookings, payments, withdrawals, alerts, pings, audit,
    settings: {
  commissionPct: settings.commissionPct,
  feePct: settings.feePct,
  minWithdrawal: settings.minWithdrawal,
  minHourlyRate: settings.minHourlyRate,
  maxHourlyRate: settings.maxHourlyRate,
},
  });
}));

router.post('/users/:id/status', ah(async (req, res) => {
  const { status, reason } = req.body || {};
  if (!['verified', 'rejected', 'suspended', 'pending'].includes(status)) bad('Bad status');
  if (String(req.params.id) === String(req.user._id) && status !== 'verified') bad('You cannot change your own account status here.');
  const u = await User.findByIdAndUpdate(oid(req.params.id), { $set: { status, rejectReason: status === 'rejected' ? String(reason || '').slice(0, 300) : undefined }, ...(status === 'suspended' ? { $inc: { tokenVersion: 1 } } : {}) }, { new: true });
  if (!u) bad('Not found', 404);
  await log(req, 'user_' + status, u._id);
  res.json({ ok: true });
}));

router.post('/users/:id/caretaker', ah(async (req, res) => {
  const on = (req.body || {}).approved === true;
  const r = await Companion.updateOne({ user: oid(req.params.id) }, { $set: { caretakerVerified: on } });
  if (!r.matchedCount) bad('This person is not a companion', 404);
  await log(req, on ? 'caretaker_approved' : 'caretaker_removed', req.params.id);
  res.json({ ok: true });
}));

/* erase a person's personal data and documents (booking records stay for accounting); also logs them out everywhere */
router.post('/users/:id/erase', ah(async (req, res) => {
  const id = oid(req.params.id);
  if (String(id) === String(req.user._id)) bad('You cannot erase your own admin account here.');
  if (await Booking.exists({ status: { $in: ['paid', 'accepted', 'in_progress', 'refund_pending'] }, $or: [{ renter: id }, { companion: id }] })) bad('This user has active bookings. Finish or refund them first.');
  const bal = await Ledger.aggregate([{ $match: { user: new mongoose.Types.ObjectId(id) } }, { $group: { _id: null, s: { $sum: '$amount' } } }]);
  if (sum(bal) > 0) bad('This user still has wallet balance. Pay it out first.');
  if (await Withdrawal.exists({ user: id, status: 'pending' })) bad('This user has a withdrawal waiting for payment. Handle it first.');
  await File.deleteMany({ owner: id });
  await Companion.deleteOne({ user: id });
  await User.updateOne({ _id: id }, { $set: { name: 'Deleted user', email: `deleted-${id}@deleted.invalid`, mobile: null, mobileVerified: false, dob: null, gender: null, state: null, city: null, idType: null, idFile: null, avatar: null, gallery: [], emergencyName: null, emergencyMobile: null, status: 'suspended', deletionRequested: false, isAdmin: false }, $unset: { passwordHash: 1, resetToken: 1, verifyToken: 1 }, $inc: { tokenVersion: 1 } });
  await log(req, 'user_erased', id);
  res.json({ ok: true });
}));

/* Paying out: you send the money from your own UPI/bank app, then mark it paid. Rejecting returns the money to the wallet (once only). */
router.post('/withdrawals/:id', ah(async (req, res) => {
  const { status, note } = req.body || {};
  if (!['paid', 'rejected'].includes(status)) bad('Bad status');
  const w = await Withdrawal.findOneAndUpdate({ _id: oid(req.params.id), status: 'pending' }, { $set: { status, note: String(note || '').slice(0, 200), paidAt: status === 'paid' ? new Date() : undefined } }, { new: true });
  if (!w) bad('Already handled');
  if (status === 'rejected') await reverseWithdrawal(w);
  await log(req, 'withdrawal_' + status, req.params.id);
  res.json({ ok: true });
}));

router.post('/alerts/:id/resolve', ah(async (req, res) => {
  await Alert.updateOne({ _id: oid(req.params.id) }, { $set: { status: 'resolved' } });
  await log(req, 'alert_resolved', req.params.id);
  res.json({ ok: true });
}));

router.put('/settings', ah(async (req, res) => {
  const b = req.body || {};

  const c = Number(b.commissionPct);
  const f = Number(b.feePct);
  const m = Number(b.minWithdrawal);
  const minRate = Number(b.minHourlyRate);
  const maxRate = Number(b.maxHourlyRate);

  if (!Number.isFinite(c) || c < 0 || c > 60) {
    bad('Commission must be between 0 and 60%.');
  }

  if (!Number.isFinite(f) || f < 0 || f > 30) {
    bad('Service fee must be between 0 and 30%.');
  }

  if (!Number.isFinite(m) || m < 100 || m > 100000) {
    bad('Minimum withdrawal must be between ₹100 and ₹100,000.');
  }

  if (!Number.isInteger(minRate) || minRate < 1 || minRate > 100000) {
    bad('Minimum hourly rate must be a whole amount between ₹1 and ₹100,000.');
  }

  if (!Number.isInteger(maxRate) || maxRate < 1 || maxRate > 100000) {
    bad('Maximum hourly rate must be a whole amount between ₹1 and ₹100,000.');
  }

  if (minRate > maxRate) {
    bad('Minimum hourly rate cannot exceed maximum hourly rate.');
  }

  await Settings.updateOne(
    { key: 'main' },
    {
      $set: {
        commissionPct: c,
        feePct: f,
        minWithdrawal: Math.round(m),
        minHourlyRate: minRate,
        maxHourlyRate: maxRate,
      },
    },
    { upsert: true }
  );

  await log(
    req,
    'settings_changed',
    `commission=${c},fee=${f},minWithdrawal=${m},minHourlyRate=${minRate},maxHourlyRate=${maxRate}`
  );

  res.json({ ok: true });
}));

router.post('/bookings/:id/refund', ah(async (req, res) => { await refundBooking(oid(req.params.id), req.user); res.json({ ok: true }); }));
router.post('/bookings/:id/complete', ah(async (req, res) => {
  const b = await completeBooking(oid(req.params.id), ' (completed by admin)');
  if (!b) bad('This booking is not in progress');
  await log(req, 'admin_complete', req.params.id); res.json({ ok: true });
}));
router.get('/bookings/:id/messages', ah(async (req, res) => {
  await log(req, 'view_chat', req.params.id);
  res.json({ list: await Message.find({ booking: oid(req.params.id) }).sort({ createdAt: 1 }).limit(300).lean() });
}));

module.exports = router;
