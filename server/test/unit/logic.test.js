// Unit tests for the pure business rules. No database or internet needed:  npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');

test('money: rupee maths and rounding (matches the amounts users saw: 263, 525)', () => {
  const s = { feePct: 5, commissionPct: 15 };
  assert.deepEqual(L.money(250, 2, s), { gross: 500, fee: 25, commission: 75, net: 425, total: 525 });
  assert.deepEqual(L.money(250, 1, s), { gross: 250, fee: 13, commission: 38, net: 212, total: 263 });
  const m = L.money(333, 3, s);
  assert.equal(m.net + m.commission, m.gross, 'companion share + commission = booking amount');
  assert.equal(m.gross + m.fee, m.total, 'renter pays booking amount + fee');
});
test('money: with 0% commission and 0% fee nothing is taken', () => {
  assert.deepEqual(L.money(100, 4, { feePct: 0, commissionPct: 0 }), { gross: 400, fee: 0, commission: 0, net: 400, total: 400 });
});

test('overlaps: touching bookings are fine, overlapping ones clash', () => {
  const t = (h) => new Date(Date.UTC(2026, 9, 12, h, 0, 0));
  assert.equal(L.overlaps(t(10), 2, t(12), 1), false, 'one ends exactly when the next starts');
  assert.equal(L.overlaps(t(12), 1, t(10), 2), false);
  assert.equal(L.overlaps(t(10), 2, t(11), 2), true, 'partial overlap');
  assert.equal(L.overlaps(t(10), 4, t(11), 1), true, 'one inside the other');
  assert.equal(L.overlaps(t(10), 1, t(10), 1), true, 'same time');
  assert.equal(L.overlaps(t(8), 1, t(20), 1), false, 'far apart');
});

test('chat filter blocks phone numbers, links and payment apps but allows normal talk', () => {
  for (const bad of ['call me 98765 43210', 'my number 9876543210', '98765-43210 ok', 'https://x.com', 'www.site.in', 'mail me a@b', 'send on gpay', 'WhatsApp me', 'use PhonePe', 'my insta']) {
    if (bad === 'my insta') { assert.equal(L.chatProblem(bad), null); continue; }
    assert.ok(L.chatProblem(bad), 'should block: ' + bad);
  }
  for (const ok of ['see you at the mall at 6 pm', 'I am wearing a blue shirt', 'Gate 3, floor 12', 'thanks!', 'running 10 minutes late']) assert.equal(L.chatProblem(ok), null, 'should allow: ' + ok);
});

test('detectMime reads the real file bytes (a renamed file cannot pass)', () => {
  const pad = (b) => Buffer.concat([Buffer.from(b), Buffer.alloc(20)]);
  assert.equal(L.detectMime(pad([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(L.detectMime(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(L.detectMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)])), 'image/webp');
  assert.equal(L.detectMime(Buffer.from('%PDF-1.7 something')), 'application/pdf');
  assert.equal(L.detectMime(Buffer.from('MZ\x90\x00this is an exe file....')), null);
  assert.equal(L.detectMime(Buffer.from('<svg onload=alert(1)></svg>')), null);
  assert.equal(L.detectMime(Buffer.alloc(3)), null);
  assert.equal(L.detectMime(null), null);
});

test('sanitizeDeep removes MongoDB operators and dotted keys', () => {
  const body = { email: { $ne: null }, password: 'x', nested: { $where: '1', ok: 1, 'a.b': 2 }, list: [{ $gt: '' }] };
  L.sanitizeDeep(body);
  assert.deepEqual(body, { email: {}, password: 'x', nested: { ok: 1 }, list: [{}] });
});

test('hmac: known-answer test and safe comparison (Razorpay signature uses the same method)', () => {
  assert.equal(L.hmacHex('key', 'The quick brown fox jumps over the lazy dog'), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  const good = L.hmacHex('secret', 'order_1|pay_1');
  assert.ok(L.safeEqual(good, L.hmacHex('secret', 'order_1|pay_1')));
  assert.ok(!L.safeEqual(good, L.hmacHex('secret', 'order_1|pay_2')), 'a different payment id must not verify');
  assert.ok(!L.safeEqual(good, L.hmacHex('other', 'order_1|pay_1')), 'a different secret must not verify');
  assert.ok(!L.safeEqual(good, 'short'));
});

test('check-in code is always 4 digits and not predictable-looking', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) { const c = L.randomCode4(); assert.match(c, /^\d{4}$/); seen.add(c); }
  assert.ok(seen.size > 300, 'codes should vary a lot, got ' + seen.size);
});

test('refund rules: who can refund which status', () => {
  assert.deepEqual(L.refundStatuses(false), ['paid', 'accepted', 'refund_pending']);
  assert.ok(L.refundStatuses(true).includes('in_progress'));
  assert.ok(!L.refundStatuses(false).includes('in_progress'), 'a meeting in progress cannot be refunded by the parties');
  assert.ok(!L.refundStatuses(true).includes('completed') && !L.refundStatuses(true).includes('refunded'));
});

test('auto-release: only 24h after the meeting ends, never when a problem was reported', () => {
  const start = new Date('2026-10-12T10:00:00Z'), H = 3600e3;
  const b = { status: 'in_progress', disputed: false, startsAt: start, hours: 2 };
  assert.equal(L.shouldAutoRelease(b, +start + 2 * H + 23 * H), false, '23h after the end');
  assert.equal(L.shouldAutoRelease(b, +start + 2 * H + 24 * H + 1000), true, '24h after the end');
  assert.equal(L.shouldAutoRelease({ ...b, disputed: true }, +start + 100 * H), false, 'disputed');
  assert.equal(L.shouldAutoRelease({ ...b, status: 'completed' }, +start + 100 * H), false, 'already completed');
  assert.equal(L.shouldAutoRelease({ ...b, hours: 4 }, +start + 2 * H + 24 * H + 1000), false, 'extra time moves the end');
});

test('unanswered requests: paid bookings past their start, and confirmed meetings that never started, are refunded', () => {
  const start = new Date('2026-10-12T10:00:00Z'), H = 3600e3;
  assert.equal(L.shouldRefundUnanswered({ status: 'paid', startsAt: start, hours: 2 }, +start - H), false, 'still time to accept');
  assert.equal(L.shouldRefundUnanswered({ status: 'paid', startsAt: start, hours: 2 }, +start + 1000), true);
  assert.equal(L.shouldRefundUnanswered({ status: 'accepted', startsAt: start, hours: 2 }, +start + 5 * H), false, 'might still start');
  assert.equal(L.shouldRefundUnanswered({ status: 'accepted', startsAt: start, hours: 2 }, +start + 2 * H + 24 * H + 1000), true);
  assert.equal(L.shouldRefundUnanswered({ status: 'in_progress', startsAt: start, hours: 2 }, +start + 999 * H), false);
});

test('dates: IST weekday, age, age groups', () => {
  assert.equal(L.istDay('2026-10-11T00:00:00Z'), 'Sun');
  assert.equal(L.istDay('2026-10-10T20:00:00Z'), 'Sun', '01:30 IST on Sunday');
  assert.equal(L.istDay('2026-10-10T17:00:00Z'), 'Sat', '22:30 IST on Saturday');
  const now = new Date('2026-10-12T00:00:00Z');
  assert.equal(L.ageOf('2008-10-13', now), 17);
  assert.equal(L.ageOf('2008-10-12', now), 18);
  const r = L.ageRange('18-25', now);
  assert.ok(r.$lte <= new Date(2008, 9, 12, 23) && r.$gte < r.$lte);
  assert.equal(L.ageRange('abc', now), null);
  assert.equal(L.ageRange('46-', now).$gte.getFullYear(), 1900);
});

test('validators', () => {
  assert.ok(L.isMobile('9876543210') && !L.isMobile('1234567890') && !L.isMobile('98765') && !L.isMobile({ $ne: 1 }));
  assert.ok(L.isEmail('a@b.co') && !L.isEmail('nope') && !L.isEmail({ $ne: 1 }));
  assert.ok(L.strongPw('abc12345') && !L.strongPw('abcdefgh') && !L.strongPw('12345678') && !L.strongPw('a1') && !L.strongPw({ $ne: 1 }));
  assert.ok(L.isUpi('name@okbank') && !L.isUpi('name') && !L.isUpi('a b@c'));
});

test('bad() throws an HttpError with a status', () => {
  assert.throws(() => L.bad('nope', 403), (e) => e instanceof L.HttpError && e.status === 403 && e.message === 'nope');
});
