const { Booking, Payment, Ledger, Withdrawal, Audit } = require('./models');
const { bad, razorpay, refundStatuses, shouldAutoRelease, shouldRefundUnanswered } = require('./util');
const { notifyAdmins } = require('./notify');

const safe = (p) => p.catch((e) => console.error('background task failed:', e.message));

/* ------------------------------------------------------------------ payments */

/** Money arrived but there is no valid booking for it: mark it and give it back automatically. */
async function refundOrphan(paymentId, bookingId, reason) {
  await Payment.updateOne({ paymentId }, { $set: { status: 'orphan', note: reason } });
  try {
    await razorpay(`/payments/${paymentId}/refund`, { notes: { reason: 'orphan payment', booking: String(bookingId) } });
    await Payment.updateOne({ paymentId }, { $set: { status: 'refunded', note: reason + ' (refunded automatically)' } });
  } catch (e) {
    if (/fully refunded|already.*refund/i.test(e.message)) { await Payment.updateOne({ paymentId }, { $set: { status: 'refunded' } }); return; }
    safe(notifyAdmins('Yaari: payment needs a manual refund', `Payment ${paymentId} (booking ${bookingId}) could not be matched to a valid booking (${reason}) and the automatic refund failed: ${e.message}. Please refund it in the Razorpay dashboard.`));
  }
}

/**
 * Marks a booking (or an extra-time purchase) as paid. Safe to run many times and in parallel
 * (the browser and the webhook both call it): the payment record is created first, the booking
 * changes state only once, and a payment that cannot be used is refunded.
 * amountPaise is optional (the webhook knows it): a different amount is treated as an orphan payment.
 */
async function markPaid(orderId, paymentId, amountPaise) {
  const b = await Booking.findOne({ razorpayOrderId: orderId });
  if (b) {
    if (amountPaise != null && Number(amountPaise) !== b.total * 100) {
      await Payment.updateOne({ paymentId }, { $setOnInsert: { booking: b._id, orderId, amount: b.total, status: 'captured' } }, { upsert: true });
      await refundOrphan(paymentId, b._id, 'Amount did not match the booking'); return b;
    }
    await Payment.updateOne({ paymentId }, { $setOnInsert: { booking: b._id, orderId, amount: b.total, status: 'captured' } }, { upsert: true });
    const r = await Booking.updateOne({ _id: b._id, status: 'pending_payment' }, { $set: { status: 'paid', razorpayPaymentId: paymentId } });
    if (!r.modifiedCount) {
      const cur = await Booking.findById(b._id).select('status razorpayPaymentId');
      if (!cur || cur.razorpayPaymentId !== paymentId) await refundOrphan(paymentId, b._id, 'Booking was no longer waiting for payment');
    }
    return b;
  }

  const eb = await Booking.findOne({ 'extensions.orderId': orderId });
  if (eb) {
    const ext = eb.extensions.find((e) => e.orderId === orderId);
    if (!ext) return null;
    await Payment.updateOne({ paymentId }, { $setOnInsert: { booking: eb._id, orderId, amount: ext.total, status: 'captured' } }, { upsert: true });
    if (ext.paymentId === paymentId && ext.status === 'paid') return eb; // replay
    if (amountPaise != null && Number(amountPaise) !== ext.total * 100) { await refundOrphan(paymentId, eb._id, 'Extra-time amount did not match'); return eb; }
    const live = eb.status === 'in_progress';
    if (!live) {
      await Booking.updateOne({ _id: eb._id, extensions: { $elemMatch: { _id: ext._id, status: 'pending_payment' } } }, { $set: { 'extensions.$.status': 'orphan', 'extensions.$.paymentId': paymentId } });
      await refundOrphan(paymentId, eb._id, 'Meeting was no longer in progress'); return eb;
    }
    const r = await Booking.updateOne(
      { _id: eb._id, status: 'in_progress', extensions: { $elemMatch: { _id: ext._id, status: 'pending_payment' } } },
      { $set: { 'extensions.$.status': 'paid', 'extensions.$.paymentId': paymentId }, $inc: { hours: ext.extraHours, gross: ext.gross, fee: ext.fee, commission: ext.commission, net: ext.net, total: ext.total } },
    );
    if (!r.modifiedCount) {
      const cur = await Booking.findById(eb._id);
      const e2 = cur && cur.extensions.find((x) => String(x._id) === String(ext._id));
      if (!e2 || e2.paymentId !== paymentId) await refundOrphan(paymentId, eb._id, 'Extra time could not be applied');
    }
    return eb;
  }
  return null;
}

/* ------------------------------------------------------------------ wallet */

/** Credits the companion exactly once per booking (a unique index on ref+type backs this up). */
async function creditEarning(b, note = '') {
  try {
    await Ledger.updateOne({ ref: b._id, type: 'earning' }, { $setOnInsert: { user: b.companion, booking: b._id, amount: b.net, note: `${b.service} with ${b.renterName || 'a renter'}${note}` } }, { upsert: true });
  } catch (e) { if (e.code !== 11000) throw e; /* already credited by a parallel call */ }
}

/** Renter (or admin, or the hourly timer) releases the payment: the booking changes state once, the wallet is credited once. */
async function completeBooking(bookingId, note = '') {
  const b = await Booking.findOneAndUpdate({ _id: bookingId, status: 'in_progress' }, { $set: { status: 'completed', completedAt: new Date() } }, { new: true });
  if (!b) return null;
  await creditEarning(b, note);
  return b;
}

async function balanceOf(userId) {
  const r = await Ledger.aggregate([{ $match: { user: userId } }, { $group: { _id: null, s: { $sum: '$amount' } } }]);
  return r.length ? r[0].s : 0;
}

/** Reverses a withdrawal exactly once (used when an admin rejects it, or it could not be recorded). */
async function reverseWithdrawal(w, note = 'Withdrawal rejected') {
  try { await Ledger.updateOne({ ref: w._id, type: 'withdrawal_reversal' }, { $setOnInsert: { user: w.user, amount: w.amount, note } }, { upsert: true }); }
  catch (e) { if (e.code !== 11000) throw e; }
}

/* ------------------------------------------------------------------ refunds */

/**
 * Refunds every captured payment of a booking (the booking itself and any paid extra time).
 * actor: a user, or {system:true} for the automatic timer.
 * - each payment is claimed (captured -> refunding) before Razorpay is called, so two clicks cannot refund it twice;
 * - if Razorpay fails half-way the booking stays "refund_pending" (money is NOT lost, it can be retried);
 * - Razorpay saying "already fully refunded" is treated as success.
 */
async function refundBooking(bookingId, actor) {
  const b0 = await Booking.findById(bookingId);
  if (!b0) bad('Booking not found', 404);
  const isSystem = !!actor.system, isAdmin = isSystem || !!actor.isAdmin;
  const isParty = !isSystem && [String(b0.renter), String(b0.companion)].includes(String(actor._id));
  if (!isAdmin && !isParty) bad('Not allowed', 403);
  const ok = refundStatuses(isAdmin);
  if (!ok.includes(b0.status)) bad('This booking can no longer be refunded');

  if (b0.status !== 'refund_pending') {
    const locked = await Booking.findOneAndUpdate({ _id: b0._id, status: { $in: ok } }, { $set: { status: 'refund_pending' } });
    if (!locked) bad('Already handled', 409);
  }
  const pays = await Payment.find({ booking: b0._id, status: 'captured' });
  if (!pays.length) {
    const left = await Payment.countDocuments({ booking: b0._id, status: 'refunding' });
    if (left) return; // another request is refunding it right now, nothing more to do here
    const refunded = await Payment.countDocuments({ booking: b0._id, status: 'refunded' });
    if (refunded) { await Booking.updateOne({ _id: b0._id, status: 'refund_pending' }, { $set: { status: 'refunded' } }); return; }
    await Booking.updateOne({ _id: b0._id, status: 'refund_pending' }, { $set: { status: b0.status === 'refund_pending' ? 'paid' : b0.status } });
    bad('No payment found for this booking');
  }

  let failure = null;
  for (const p of pays) {
    const claim = await Payment.findOneAndUpdate({ _id: p._id, status: 'captured' }, { $set: { status: 'refunding' } });
    if (!claim) continue; // someone else is already refunding it
    try {
      await razorpay(`/payments/${p.paymentId}/refund`, { notes: { booking: String(b0._id) } });
      await Payment.updateOne({ _id: p._id }, { $set: { status: 'refunded' } });
    } catch (e) {
      if (/fully refunded|already.*refund/i.test(e.message)) { await Payment.updateOne({ _id: p._id }, { $set: { status: 'refunded' } }); continue; }
      await Payment.updateOne({ _id: p._id }, { $set: { status: 'captured' } });
      failure = e;
    }
  }
  if (failure) {
    safe(notifyAdmins('Yaari: a refund failed', `Booking ${b0._id}: ${failure.message}. The booking is marked "refund_pending". Retry from the admin panel (Bookings, open the booking, Refund).`));
    throw failure;
  }
  const left = await Payment.countDocuments({ booking: b0._id, status: { $in: ['captured', 'refunding'] } });
  if (!left) await Booking.updateOne({ _id: b0._id, status: 'refund_pending' }, { $set: { status: 'refunded' } });
  if (isAdmin && !isSystem) await Audit.create({ admin: actor._id, action: 'refund', target: String(b0._id) });
}

/* ------------------------------------------------------------------ timers (run every hour) */

/** 24 hours after a meeting ends, if nobody reported a problem, the payment is released automatically. */
async function autoRelease(now = Date.now()) {
  const list = await Booking.find({ status: 'in_progress', disputed: false, startsAt: { $lt: new Date(now - 24 * 3600e3) } }).select('startsAt hours disputed status');
  let n = 0;
  for (const b of list) if (shouldAutoRelease(b, now) && (await completeBooking(b._id, ' (auto-released)'))) n++;
  return n;
}

/** Money must never be stuck: unanswered paid requests and meetings that never started are refunded. */
async function refundUnanswered(now = Date.now()) {
  const list = await Booking.find({ $or: [{ status: 'paid', startsAt: { $lt: new Date(now) } }, { status: 'accepted', startsAt: { $lt: new Date(now - 24 * 3600e3) } }] }).select('startsAt hours status');
  let n = 0;
  for (const b of list) {
    if (!shouldRefundUnanswered(b, now)) continue;
    try { await refundBooking(b._id, { system: true }); n++; } catch (e) { console.error('auto-refund failed for', String(b._id), e.message); }
  }
  return n;
}

/** Bookings nobody paid within 24 hours are cancelled (a late payment is refunded automatically as an orphan). */
async function expirePending(now = Date.now()) {
  const r = await Booking.updateMany({ status: 'pending_payment', createdAt: { $lt: new Date(now - 24 * 3600e3) } }, { $set: { status: 'cancelled' } });
  return r.modifiedCount || 0;
}

/** Repairs anything a crash may have left half-done. All steps are safe to repeat. */
async function repair(now = Date.now()) {
  let fixed = 0;
  // completed bookings without a wallet credit
  const done = await Booking.find({ status: 'completed', completedAt: { $gt: new Date(now - 30 * 24 * 3600e3) } }).select('companion net service renterName').limit(2000);
  if (done.length) {
    const have = new Set((await Ledger.find({ type: 'earning', ref: { $in: done.map((b) => b._id) } }).select('ref').lean()).map((x) => String(x.ref)));
    for (const b of done) if (!have.has(String(b._id))) { await creditEarning(b, ' (repaired)'); fixed++; }
  }
  // rejected withdrawals without a reversal
  const rej = await Withdrawal.find({ status: 'rejected', updatedAt: { $gt: new Date(now - 30 * 24 * 3600e3) } }).limit(500);
  for (const w of rej) {
    const has = await Ledger.exists({ ref: w._id, type: 'withdrawal_reversal' });
    if (!has) { await reverseWithdrawal(w); fixed++; }
  }
  // payments stuck in "refunding" (a crash during the refund): put back so the refund can be retried
  const stuck = await Payment.updateMany({ status: 'refunding', updatedAt: { $lt: new Date(now - 10 * 60e3) } }, { $set: { status: 'captured' } });
  return fixed + (stuck.modifiedCount || 0);
}

module.exports = { markPaid, creditEarning, completeBooking, balanceOf, reverseWithdrawal, refundBooking, autoRelease, refundUnanswered, expirePending, repair, refundOrphan };
