// Booking clashes, Razorpay payment, verification, webhook, refunds. (Razorpay is a fake local server.)
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let ctx;
test.before(async () => { ctx = await H.boot(); });
test.after(async () => { await ctx.stop(); });
test.beforeEach(async () => { await ctx.reset(); });
const api = () => H.request(ctx.app);

test('booking: the same companion cannot be booked twice at the same time (5 people at once, only 1 wins)', async () => {
  const comp = await H.makeCompanion(ctx);
  const renters = await Promise.all([1, 2, 3, 4, 5].map(() => H.makeUser(ctx)));
  const results = await Promise.all(renters.map((r) => r.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 30, 2))));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 1, 'exactly one booking must succeed, got ' + ok + ' (' + results.map((r) => r.status).join(',') + ')');
  assert.equal(await ctx.models.Booking.countDocuments({}), 1);
});

test('booking: overlapping times are refused, back-to-back times are allowed', async () => {
  const comp = await H.makeCompanion(ctx); const a = await H.makeUser(ctx), b = await H.makeUser(ctx);
  assert.equal((await a.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 30, 2))).status, 200);
  assert.equal((await b.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 31, 2))).status, 400, 'starts inside the first');
  assert.equal((await b.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 32, 2))).status, 200, 'starts exactly when the first ends');
});

test('booking: needs a photo, a verified account, an offered service, an allowed venue, a day the companion works', async () => {
  const comp = await H.makeCompanion(ctx, { days: ['Mon'] });
  const nophoto = await H.makeUser(ctx, { photo: false }), pending = await H.makeUser(ctx, { status: 'pending' }), ok = await H.makeUser(ctx);
  assert.equal((await nophoto.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).status, 400);
  assert.equal((await pending.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).status, 403);
  assert.equal((await ok.auth(api().post('/api/bookings')).send({ ...H.bookingBody(comp.user._id), service: 'Wedding' })).status, 400, 'service not offered');
  assert.equal((await ok.auth(api().post('/api/bookings')).send({ ...H.bookingBody(comp.user._id), venueType: 'Home (verified caretakers only)' })).status, 400, 'venue not allowed for this service');
  assert.equal((await ok.auth(api().post('/api/bookings')).send({ ...H.bookingBody(comp.user._id), hours: 9 })).status, 400);
  assert.equal((await ok.auth(api().post('/api/bookings')).send({ ...H.bookingBody(comp.user._id, 0.2) })).status, 400, 'too soon');
  assert.equal((await ok.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 24 * 130, 1))).status, 400, 'more than 120 days ahead')
});

test('booking: renters cannot book themselves or a blocked person; the price is calculated on the server', async () => {
  const comp = await H.makeCompanion(ctx, { rate: 250 }); const renter = await H.makeUser(ctx);
  assert.equal((await comp.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).status, 400);
  const r = await renter.auth(api().post('/api/bookings')).send({ ...H.bookingBody(comp.user._id, 30, 2), total: 1, rate: 1, gross: 1, net: 99999 });
  assert.equal(r.status, 200); assert.equal(r.body.booking.total, 525, 'prices sent by the browser are ignored'); assert.equal(r.body.booking.net, 425);
  assert.equal(r.body.booking.checkinCode, undefined, 'the code is never returned on creation');
  await renter.auth(api().post('/api/safety/block')).send({ userId: String(comp.user._id) });
  assert.equal((await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id, 100, 1))).status, 400);
  assert.equal((await renter.auth(api().get('/api/companions'))).body.list.length, 0, 'blocked people disappear from Browse');
});

test('payment: a wrong signature is refused, a right one marks the booking paid', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const b = (await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).body.booking;
  const o = (await renter.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).body;
  assert.equal(o.amount, 52500, 'amount in paise comes from the server');
  const bad = await renter.auth(api().post('/api/payments/verify')).send({ razorpay_order_id: o.orderId, razorpay_payment_id: 'pay_x', razorpay_signature: 'f'.repeat(64) });
  assert.equal(bad.status, 400); assert.equal((await ctx.models.Booking.findById(b._id)).status, 'pending_payment');
  const good = await renter.auth(api().post('/api/payments/verify')).send({ razorpay_order_id: o.orderId, razorpay_payment_id: 'pay_ok1', razorpay_signature: H.sign(o.orderId, 'pay_ok1') });
  assert.equal(good.status, 200); assert.equal((await ctx.models.Booking.findById(b._id)).status, 'paid');
});

test('payment: someone else cannot confirm my payment, and the same order id is re-used (no second order)', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx), stranger = await H.makeUser(ctx);
  const b = (await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).body.booking;
  const o1 = (await renter.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).body;
  const o2 = (await renter.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).body;
  assert.equal(o1.orderId, o2.orderId); assert.equal(H.razorpayCalls.orders.length, 1);
  assert.equal((await stranger.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).status, 404);
  const r = await stranger.auth(api().post('/api/payments/verify')).send({ razorpay_order_id: o1.orderId, razorpay_payment_id: 'pay_s', razorpay_signature: H.sign(o1.orderId, 'pay_s') });
  assert.equal(r.status, 404);
});

test('payment: browser verify + webhook + repeated webhook = ONE payment record, booking paid once', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp, 30, 2, 'pay_dup');
  assert.equal(p.verify.status, 200);
  const raw = H.webhookBody(p.orderId, 'pay_dup', 52500);
  for (let i = 0; i < 3; i++) assert.equal((await api().post('/api/payments/webhook').set('x-razorpay-signature', H.webhookSig(raw)).set('Content-Type', 'application/json').send(raw)).status, 200);
  assert.equal(await ctx.models.Payment.countDocuments({ paymentId: 'pay_dup' }), 1);
  assert.equal((await ctx.models.Booking.findById(p.id)).status, 'paid');
  assert.equal(H.razorpayCalls.refunds.length, 0, 'nothing is refunded');
});

test('webhook: bad or missing signature is refused and changes nothing', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const b = (await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).body.booking;
  const o = (await renter.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).body;
  const raw = H.webhookBody(o.orderId, 'pay_w', 52500);
  assert.equal((await api().post('/api/payments/webhook').set('Content-Type', 'application/json').send(raw)).status, 400);
  assert.equal((await api().post('/api/payments/webhook').set('x-razorpay-signature', 'a'.repeat(64)).set('Content-Type', 'application/json').send(raw)).status, 400);
  assert.equal((await ctx.models.Booking.findById(b._id)).status, 'pending_payment');
});

test('webhook with a wrong amount: payment is marked orphan and refunded automatically', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const b = (await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).body.booking;
  const o = (await renter.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).body;
  const raw = H.webhookBody(o.orderId, 'pay_wrong', 100);
  await api().post('/api/payments/webhook').set('x-razorpay-signature', H.webhookSig(raw)).set('Content-Type', 'application/json').send(raw);
  assert.equal((await ctx.models.Booking.findById(b._id)).status, 'pending_payment');
  assert.equal((await ctx.models.Payment.findOne({ paymentId: 'pay_wrong' })).status, 'refunded'); assert.deepEqual(H.razorpayCalls.refunds, ['pay_wrong']);
});

test('paying a booking that was already cancelled: the money is given back automatically', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const b = (await renter.auth(api().post('/api/bookings')).send(H.bookingBody(comp.user._id))).body.booking;
  const o = (await renter.auth(api().post(`/api/bookings/${b._id}/pay-order`)).send({})).body;
  await renter.auth(api().post(`/api/bookings/${b._id}/cancel-unpaid`)).send({});
  await renter.auth(api().post('/api/payments/verify')).send({ razorpay_order_id: o.orderId, razorpay_payment_id: 'pay_late', razorpay_signature: H.sign(o.orderId, 'pay_late') });
  assert.equal((await ctx.models.Booking.findById(b._id)).status, 'cancelled');
  assert.equal((await ctx.models.Payment.findOne({ paymentId: 'pay_late' })).status, 'refunded');
});

test('refund: renter cancels a paid booking, money returns once even if tapped 3 times together', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  const rs = await Promise.all([1, 2, 3].map(() => renter.auth(api().post(`/api/bookings/${p.id}/refund`)).send({})));
  assert.ok(rs.some((r) => r.status === 200));
  assert.equal(H.razorpayCalls.refunds.filter((x) => x === p.payId).length, 1, 'Razorpay must be asked to refund exactly once');
  assert.equal((await ctx.models.Booking.findById(p.id)).status, 'refunded');
});

test('refund: nobody else, and no refund once the meeting is in progress (except admin)', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx), stranger = await H.makeUser(ctx), admin = await H.makeUser(ctx, { admin: true });
  const p = await H.bookAndPay(ctx, renter, comp);
  assert.equal((await stranger.auth(api().post(`/api/bookings/${p.id}/refund`)).send({})).status, 403, 'a stranger cannot refund')
  await H.acceptAndStart(ctx, comp, p.id);
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/refund`)).send({})).status, 400);
  assert.equal((await admin.auth(api().post(`/api/admin/bookings/${p.id}/refund`)).send({})).status, 200);
});

test('refund: if Razorpay fails the booking becomes refund_pending, and a retry finishes it', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  H.setFailRefund('Gateway is down');
  const r1 = await renter.auth(api().post(`/api/bookings/${p.id}/refund`)).send({});
  assert.ok(r1.status >= 400);
  assert.equal((await ctx.models.Booking.findById(p.id)).status, 'refund_pending');
  assert.equal((await ctx.models.Payment.findOne({ paymentId: p.payId })).status, 'captured', 'the money is still marked as not refunded');
  H.setFailRefund(null);
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/refund`)).send({})).status, 200);
  assert.equal((await ctx.models.Booking.findById(p.id)).status, 'refunded');
});

test('refund: "already fully refunded" from Razorpay is treated as success', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  H.setFailRefund('The payment has been fully refunded already');
  assert.equal((await renter.auth(api().post(`/api/bookings/${p.id}/refund`)).send({})).status, 200);
  assert.equal((await ctx.models.Booking.findById(p.id)).status, 'refunded');
});

test('check-in code: only 5 wrong tries, then the booking cannot be started by guessing', async () => {
  const comp = await H.makeCompanion(ctx), renter = await H.makeUser(ctx);
  const p = await H.bookAndPay(ctx, renter, comp);
  await comp.auth(api().post(`/api/bookings/${p.id}/accept`)).send({});
  const real = (await ctx.models.Booking.findById(p.id).select('+checkinCode')).checkinCode;
  const wrong = real === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) assert.equal((await comp.auth(api().post(`/api/bookings/${p.id}/start`)).send({ code: wrong })).status, 400);
  assert.equal((await comp.auth(api().post(`/api/bookings/${p.id}/start`)).send({ code: real })).status, 429, 'even the right code is refused after 5 wrong tries');
  assert.equal((await comp.auth(api().get('/api/bookings/requests'))).body.list[0].checkinCode, undefined, 'the companion never sees the code');
});
