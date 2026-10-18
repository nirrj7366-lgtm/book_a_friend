// Tests for the setup checker (preflight). npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { check, findPlaceholders } = require('../../src/preflight');

const good = { isProd: true, jwtSecret: 'k9Xv2LmQ8zTa4WnB7yRc3PdH6sFj1UeG5oIt0Zq', mongo: 'mongodb+srv://u:p@c.mongodb.net/yaari', appUrl: 'https://yaari.example.com',
  rz: { keyId: 'rzp_test_abc', keySecret: 's', webhookSecret: 'w' }, smtp: { host: 'smtp.x.com' }, alert: { email: 'a@b.com' }, cspMode: 'report', requireEmailVerify: true };

test('a complete setup has no errors and no warnings', () => { const r = check(good); assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []); });
test('weak or missing JWT_SECRET is an error', () => {
  for (const s of ['', 'short', 'change-me-change-me-change-me-change-me', 'a'.repeat(50), 'x'.repeat(40)]) assert.ok(check({ ...good, jwtSecret: s }).errors.length, 'should reject: ' + s);
});
test('placeholder MongoDB string is an error', () => assert.ok(check({ ...good, mongo: 'mongodb+srv://USER:PASSWORD@cluster0.mongodb.net/yaari' }).errors.length));
test('missing Razorpay, webhook secret, SMTP, alert address and localhost URL are warnings', () => {
  const w = check({ ...good, rz: { keyId: '', keySecret: '', webhookSecret: '' }, smtp: { host: '' }, alert: { email: '' }, appUrl: 'http://localhost:4000', requireEmailVerify: false }).warnings.join(' | ');
  for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_WEBHOOK_SECRET', 'SMTP_HOST', 'ALERT_EMAIL', 'APP_URL', 'REQUIRE_EMAIL_VERIFY']) assert.ok(w.includes(k), 'missing warning for ' + k);
});
test('live keys outside production produce a warning', () => assert.ok(check({ ...good, isProd: false, rz: { keyId: 'rzp_live_x', keySecret: 's', webhookSecret: 'w' } }).warnings.some((w) => /LIVE/.test(w))));
test('findPlaceholders spots business details that were not filled in', () => {
  assert.deepEqual(findPlaceholders('name: "YOUR BUSINESS NAME", address: "YOUR FULL ADDRESS", email: "YOUR SUPPORT EMAIL", phone: "YOUR PHONE NUMBER", grievanceOfficer: "YOUR NAME"').sort(), ['address', 'email', 'grievanceOfficer', 'name', 'phone']);
  assert.deepEqual(findPlaceholders('name: "Yaari Pvt Ltd", address: "1 Park St", email: "a@b.in", phone: "9876543210", grievanceOfficer: "R Das"'), []);
});
