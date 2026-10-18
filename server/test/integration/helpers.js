// Shared set-up for the integration tests: a real (in-memory) MongoDB replica set, the real app, and a FAKE Razorpay server.
// Nothing here talks to the real Razorpay or your real database. Needs internet only once (mongodb-memory-server downloads mongod).
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const SECRET = 'rz_secret_for_tests', WEBHOOK = 'whsec_for_tests';
const sentMail = [];
const razorpayCalls = { orders: [], refunds: [] };
let failRefund = null; // set to a message to make the fake Razorpay refuse refunds

function startFakeRazorpay() {
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {}; res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/orders') { const o = { id: 'order_' + ++n, amount: json.amount, currency: 'INR' }; razorpayCalls.orders.push(o); return res.end(JSON.stringify(o)); }
      const m = /^\/payments\/([^/]+)\/refund$/.exec(req.url);
      if (req.method === 'POST' && m) {
        razorpayCalls.refunds.push(m[1]);
        if (failRefund) { res.statusCode = 400; return res.end(JSON.stringify({ error: { description: failRefund } })); }
        return res.end(JSON.stringify({ id: 'rfnd_' + n++, payment_id: m[1] }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

async function boot() {
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const fake = await startFakeRazorpay();
  Object.assign(process.env, {
    NODE_ENV: 'test', JWT_SECRET: 'k9Xv2LmQ8zTa4WnB7yRc3PdH6sFj1UeG5oIt0Zq', MONGODB_URI: repl.getUri('yaari_test'), APP_URL: 'http://localhost:4000',
    RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK, RAZORPAY_BASE_URL: fake.url, REQUIRE_ID_UPLOAD: 'true',
  });
  // capture e-mails instead of sending them
  const mailerPath = require.resolve('../../src/mailer');
  require.cache[mailerPath] = { id: mailerPath, filename: mailerPath, loaded: true, exports: { sendMail: async (to, subject, text) => { sentMail.push({ to, subject, text }); } } };
  const app = require('../../src/index');
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const models = require('../../src/models');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build the unique indexes the safety rules depend on
  return {
    app, models, mongoose, request,
    async stop() { await mongoose.disconnect(); await repl.stop(); fake.server.close(); },
    async reset() { await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({}))); sentMail.length = 0; razorpayCalls.orders.length = 0; razorpayCalls.refunds.length = 0; failRefund = null; },
  };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
let counter = 0;
async function makeUser(ctx, o = {}) {
  const { User, File } = ctx.models; const { signToken } = require('../../src/middleware');
  const n = ++counter;
  const u = await User.create({
    email: o.email || `user${n}@test.com`, name: o.name || `User${n} Test`, mobile: '98765' + String(10000 + n), passwordHash: await bcrypt.hash('Passw0rd1', 4), emailVerified: true,
    status: o.status || 'verified', isAdmin: !!o.admin, dob: new Date('1998-01-01'), gender: 'Male', state: 'West Bengal', city: 'Kolkata', idType: 'PAN card', emergencyName: 'Mum', emergencyMobile: '9123456789',
  });
  if (o.photo !== false) { const f = await File.create({ owner: u._id, kind: 'avatar', mime: 'image/png', size: 72, data: PNG }); u.avatar = f._id; await u.save(); }
  return { user: u, token: signToken(u), auth: (r) => r.set('Authorization', 'Bearer ' + signToken(u)) };
}
async function makeCompanion(ctx, o = {}) {
  const c = await makeUser(ctx, o);
  await ctx.models.Companion.create({ user: c.user._id, services: o.services || ['Shopping', 'Study'], rate: o.rate || 250, bio: 'A friendly companion who likes good conversation.', days: o.days || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] });
  return c;
}
const futureAt = (hoursFromNow) => new Date(Date.now() + hoursFromNow * 3600e3).toISOString();
const bookingBody = (companionId, hoursFromNow = 30, hours = 2) => ({ companion: String(companionId), service: 'Shopping', hours, startsAt: futureAt(hoursFromNow), venueType: 'Mall / Market', venueName: 'South City Mall' });
const sign = (orderId, payId) => require('../../src/logic').hmacHex(SECRET, `${orderId}|${payId}`);
const webhookBody = (orderId, payId, amount) => JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: orderId, amount } } } });
const webhookSig = (raw) => require('../../src/logic').hmacHex(WEBHOOK, raw);

/** create a booking through the real API, pay it through the real endpoints, return everything */
async function bookAndPay(ctx, renter, comp, hoursFromNow = 30, hours = 2, payId = 'pay_' + Math.random().toString(36).slice(2, 10)) {
  const r = await renter.auth(request(ctx.app).post('/api/bookings')).send(bookingBody(comp.user._id, hoursFromNow, hours));
  if (r.status !== 200) throw new Error('booking failed: ' + JSON.stringify(r.body));
  const id = r.body.booking._id;
  const o = await renter.auth(request(ctx.app).post(`/api/bookings/${id}/pay-order`)).send({});
  const v = await renter.auth(request(ctx.app).post('/api/payments/verify')).send({ razorpay_order_id: o.body.orderId, razorpay_payment_id: payId, razorpay_signature: sign(o.body.orderId, payId) });
  return { id, orderId: o.body.orderId, payId, verify: v };
}
/** accept + start + (the code is read straight from the database) */
async function acceptAndStart(ctx, comp, id) {
  await comp.auth(request(ctx.app).post(`/api/bookings/${id}/accept`)).send({});
  const b = await ctx.models.Booking.findById(id).select('+checkinCode');
  return comp.auth(request(ctx.app).post(`/api/bookings/${id}/start`)).send({ code: b.checkinCode });
}

module.exports = { PNG, boot, makeUser, makeCompanion, bookingBody, futureAt, sign, webhookBody, webhookSig, bookAndPay, acceptAndStart, sentMail, razorpayCalls, setFailRefund: (m) => { failRefund = m; }, request, SECRET, WEBHOOK };
