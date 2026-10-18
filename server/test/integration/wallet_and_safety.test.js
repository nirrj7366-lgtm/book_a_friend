// Wallet, commission, withdrawals, extra time, auto-release, SOS notifications, chat, reviews, timers.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let ctx, S;
test.before(async () => { ctx = await H.boot(); S = require('../../src/services'); });
test.after(async () => { await ctx.stop(); });
test.beforeEach(async () => { await ctx.reset(); });
const api = () => H.request(ctx.app);
const balance = async (u) => (await ctx.models.Ledger.aggregate([{ $match: { user: u.user._id } }, { $group: { _id: null, s: { $sum: '$amount' } } }]))[0]?.s || 0;
async function meeting(hours = 2, rate = 250) {
  const comp = await H.makeCompanion(ctx, { rate }), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp, 30, hours);
  assert.equal((await H.acceptAndStart(ctx, comp, p.id)).status, 200);
  return { comp, renter, ...p };
}

test('commission: 2 hours at Rs 250 -> companion gets 425, Yaari earns 75 + 25 fee, wallet credited once', async () => {
  const m = await meeting();
  assert.equal((await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({})).status, 200);
  assert.equal(await balance(m.comp), 425);
  const b = await ctx.models.Booking.findById(m.id); assert.equal(b.fee + b.commission, 100); assert.equal(b.net + b.commission, b.gross);
});

test('wallet: releasing the same meeting 5 times together credits the companion ONCE', async () => {
  const m = await meeting();
  await Promise.all([1, 2, 3, 4, 5].map(() => m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({})));
  await Promise.all([1, 2, 3].map(() => S.completeBooking(m.id)));
  assert.equal(await ctx.models.Ledger.countDocuments({ user: m.comp.user._id, type: 'earning' }), 1);
  assert.equal(await balance(m.comp), 425);
});

test('wallet: only the renter can release the money, and only after the meeting started', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/complete`)).send({})).status, 400, 'not started yet');
  await H.acceptAndStart(ctx, comp, p.id);
  assert.equal((await comp.auth(api().post(`/api/bookings/${p.id}/complete`)).send({})).status, 404, 'the companion cannot release money to themselves');
});

test('extra time: payment adds hours and earnings; a replay of the same payment adds nothing twice', async () => {
  const m = await meeting(2);
  const e = await m.renter.auth(api().post(`/api/bookings/${m.id}/extend`)).send({ extraHours: 2 });
  assert.equal(e.status, 200); assert.equal(e.body.amount, 52500);
  const sig = H.sign(e.body.orderId, 'pay_ext');
  for (let i = 0; i < 3; i++) assert.equal((await m.renter.auth(api().post('/api/payments/verify')).send({ razorpay_order_id: e.body.orderId, razorpay_payment_id: 'pay_ext', razorpay_signature: sig })).status, 200);
  const b = await ctx.models.Booking.findById(m.id);
  assert.equal(b.hours, 4); assert.equal(b.net, 850); assert.equal(b.total, 1050);
  await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  assert.equal(await balance(m.comp), 850, 'the companion earns for all 4 hours');
  assert.equal(await ctx.models.Payment.countDocuments({ paymentId: 'pay_ext' }), 1);
});

test('extra time: refused if the companion has another booking right after', async () => {
  const m = await meeting(2);
  const other = await H.makeUser(ctx);
  await ctx.models.Booking.create({ renter: other.user._id, companion: m.comp.user._id, startsAt: new Date((await ctx.models.Booking.findById(m.id)).startsAt.getTime() + 2 * 3600e3), hours: 1, status: 'paid', service: 'Shopping', total: 1, net: 1 });
  assert.equal((await m.renter.auth(api().post(`/api/bookings/${m.id}/extend`)).send({ extraHours: 1 })).status, 400);
});

test('extra time paid after the meeting ended is refunded automatically (companion is not credited)', async () => {
  const m = await meeting(2);
  const e = await m.renter.auth(api().post(`/api/bookings/${m.id}/extend`)).send({ extraHours: 1 });
  await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  await m.renter.auth(api().post('/api/payments/verify')).send({ razorpay_order_id: e.body.orderId, razorpay_payment_id: 'pay_toolate', razorpay_signature: H.sign(e.body.orderId, 'pay_toolate') });
  assert.equal((await ctx.models.Booking.findById(m.id)).hours, 2);
  assert.equal((await ctx.models.Payment.findOne({ paymentId: 'pay_toolate' })).status, 'refunded');
});

test('auto-release: pays after 24h, but not when a problem was reported', async () => {
  const a = await meeting(), b = await meeting();
  await b.renter.auth(api().post(`/api/bookings/${b.id}/problem`)).send({ note: 'He did not show proper behaviour' });
  const long = Date.now() + 5 * 24 * 3600e3;
  const n = await S.autoRelease(long);
  assert.equal(n, 1);
  assert.equal((await ctx.models.Booking.findById(a.id)).status, 'completed'); assert.equal(await balance(a.comp), 425);
  assert.equal((await ctx.models.Booking.findById(b.id)).status, 'in_progress'); assert.equal(await balance(b.comp), 0);
  assert.equal(await S.autoRelease(long), 0, 'running it again changes nothing');
});

test('timers: unanswered paid requests are refunded, unpaid bookings expire, repair credits a missing earning', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  assert.equal(await S.refundUnanswered(Date.now() + 40 * 3600e3), 1);
  assert.equal((await ctx.models.Booking.findById(p.id)).status, 'refunded');
  const pend = (await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 60))).body.booking;
  assert.equal(await S.expirePending(Date.now() + 25 * 3600e3), 1);
  assert.equal((await ctx.models.Booking.findById(pend._id)).status, 'cancelled');
  const m = await meeting(); await ctx.models.Booking.updateOne({ _id: m.id }, { $set: { status: 'completed', completedAt: new Date() } });
  assert.equal(await balance(m.comp), 0); await S.repair(); await S.repair();
  assert.equal(await balance(m.comp), 425, 'a crash between "completed" and "credit" is repaired, once');
});

test('withdrawal: double tap pays out once; minimum is enforced; the wallet is debited once', async () => {
  const m = await meeting(4, 250); await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  assert.equal(await balance(m.comp), 850);
  const rs = await Promise.all([1, 2, 3].map(() => m.comp.auth(api().post('/api/safety/withdraw')).send({ upi: 'asha@okbank' })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1, 'only one request goes through: ' + rs.map((r) => r.status));
  assert.equal(await balance(m.comp), 0); assert.equal(await ctx.models.Withdrawal.countDocuments({}), 1);
  assert.equal((await m.comp.auth(api().post('/api/safety/withdraw')).send({ upi: 'asha@okbank' })).status, 400, 'balance is now below the minimum');
  assert.equal((await m.comp.auth(api().post('/api/safety/withdraw')).send({ upi: 'bad upi' })).status, 400);
});

test('withdrawal: rejecting returns the money exactly once, even if the admin taps twice', async () => {
  const m = await meeting(4); await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  await m.comp.auth(api().post('/api/safety/withdraw')).send({ upi: 'asha@okbank' });
  const admin = await H.makeUser(ctx, { admin: true }); const w = await ctx.models.Withdrawal.findOne({});
  const rs = await Promise.all([1, 2].map(() => admin.auth(api().post(`/api/admin/withdrawals/${w._id}`)).send({ status: 'rejected', note: 'wrong UPI' })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(await balance(m.comp), 850, 'money back once, not twice');
  assert.equal((await admin.auth(api().post(`/api/admin/withdrawals/${w._id}`)).send({ status: 'paid' })).status, 400, 'already handled');
  assert.equal((await m.comp.auth(api().post('/api/safety/withdraw')).send({ upi: 'asha@okbank' })).status, 200, 'a new request is possible after the rejection');
});

test('withdrawal: paying marks it paid and the wallet stays debited; a stranger cannot call the admin route', async () => {
  const m = await meeting(4); await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  await m.comp.auth(api().post('/api/safety/withdraw')).send({ upi: 'asha@okbank' });
  const w = await ctx.models.Withdrawal.findOne({}), admin = await H.makeUser(ctx, { admin: true });
  assert.equal((await m.comp.auth(api().post(`/api/admin/withdrawals/${w._id}`)).send({ status: 'paid' })).status, 403);
  assert.equal((await admin.auth(api().post(`/api/admin/withdrawals/${w._id}`)).send({ status: 'paid' })).status, 200);
  assert.equal(await balance(m.comp), 0);
});

test('SOS: saved, and a REAL e-mail goes to every admin with the person, booking and map link', async () => {
  const admin = await H.makeUser(ctx, { admin: true, email: 'boss@test.com' });
  const m = await meeting();
  const r = await m.renter.auth(api().post('/api/safety/sos')).send({ bookingId: m.id, lat: 22.5726, lng: 88.3639 });
  assert.equal(r.status, 200);
  await new Promise((ok) => setTimeout(ok, 300)); // the notification runs in the background
  const mail = H.sentMail.find((x) => x.to === 'boss@test.com' && /SOS/.test(x.subject));
  assert.ok(mail, 'the admin got an SOS e-mail'); assert.match(mail.text, /google\.com\/maps\?q=22\.5726,88\.3639/); assert.match(mail.text, /Emergency contact/);
  assert.equal((await ctx.models.Alert.findOne({ type: 'SOS' })).notified, true);
  assert.equal((await admin.auth(api().get('/api/admin/stats'))).body.openSos, 1, 'the admin panel counter shows it');
});

test('SOS: coordinates outside the earth are rejected; a booking that is not yours is ignored', async () => {
  const m = await meeting(), stranger = await H.makeUser(ctx);
  assert.equal((await m.renter.auth(api().post('/api/safety/sos')).send({ lat: 999, lng: 0 })).status, 400);
  await stranger.auth(api().post('/api/safety/sos')).send({ bookingId: m.id });
  assert.equal((await ctx.models.Alert.findOne({ user: stranger.user._id })).booking, undefined);
});

test('SOS retry: if e-mail was down the timer tries again', async () => {
  await H.makeUser(ctx, { admin: true, email: 'boss@test.com' }); const u = await H.makeUser(ctx);
  await ctx.models.Alert.create({ user: u.user._id, type: 'SOS', note: 'SOS pressed', notified: false });
  const n = await require('../../src/cron').retryAlerts();
  assert.equal(n, 1); assert.ok(H.sentMail.some((x) => x.to === 'boss@test.com'));
});

test('chat: only the two people, only after confirmation, phone numbers blocked, new messages only', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx), stranger = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/messages`)).send({ body: 'hello' })).status, 400, 'not confirmed yet');
  await comp.auth(api().post(`/api/bookings/${p.id}/accept`)).send({});
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/messages`)).send({ body: 'hello there' })).status, 200);
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/messages`)).send({ body: 'call 98765 43210' })).status, 400);
  assert.equal((await stranger.auth(api().get(`/api/bookings/${p.id}/messages`))).status, 404);
  const all = await comp.auth(api().get(`/api/bookings/${p.id}/messages`)); assert.equal(all.body.list.length, 1);
  const after = await comp.auth(api().get(`/api/bookings/${p.id}/messages`).query({ after: all.body.list[0].createdAt })); assert.equal(after.body.list.length, 0);
});

test('reviews: one per meeting, only the renter, only when completed; the average updates', async () => {
  const m = await meeting();
  assert.equal((await m.renter.auth(api().post(`/api/bookings/${m.id}/review`)).send({ stars: 5 })).status, 400, 'not completed yet');
  await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  assert.equal((await m.comp.auth(api().post(`/api/bookings/${m.id}/review`)).send({ stars: 5 })).status, 404);
  assert.equal((await m.renter.auth(api().post(`/api/bookings/${m.id}/review`)).send({ stars: 6 })).status, 400);
  const rs = await Promise.all([1, 2].map(() => m.renter.auth(api().post(`/api/bookings/${m.id}/review`)).send({ stars: 4, comment: 'Nice' })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  const c = await ctx.models.Companion.findOne({ user: m.comp.user._id }); assert.equal(c.ratingCount, 1); assert.equal(c.ratingSum, 4);
});

test('admin stats and data match the database', async () => {
  const admin = await H.makeUser(ctx, { admin: true }); const m = await meeting(); await m.renter.auth(api().post(`/api/bookings/${m.id}/complete`)).send({});
  const s = (await admin.auth(api().get('/api/admin/stats'))).body;
  assert.equal(s.owed, 425); assert.equal(s.platform, 100); assert.equal(s.collected, 525); assert.equal(s.bookings.completed, 1);
  const d = (await admin.auth(api().get('/api/admin/data'))).body;
  assert.equal(JSON.stringify(d).includes('passwordHash'), false); assert.equal(d.bookings[0].razorpayPaymentId !== undefined, true, 'admin can see payment ids');
});
