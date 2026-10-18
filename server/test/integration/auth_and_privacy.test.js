// Login security, document privacy, permissions. Needs: npm install, then npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let ctx;
test.before(async () => { ctx = await H.boot(); });
test.after(async () => { await ctx.stop(); });
test.beforeEach(async () => { await ctx.reset(); });
const api = () => H.request(ctx.app);

test('signup, login, and /me work', async () => {
  const s = await api().post('/api/auth/signup').send({ name: 'Asha Roy', email: 'asha@test.com', mobile: '9876543210', password: 'Passw0rd1', age18: true, agreeTerms: true });
  assert.equal(s.status, 200); assert.ok(s.body.token);
  const l = await api().post('/api/auth/login').send({ email: 'ASHA@test.com', password: 'Passw0rd1' });
  assert.equal(l.status, 200);
  const me = await api().get('/api/auth/me').set('Authorization', 'Bearer ' + l.body.token);
  assert.equal(me.body.user.email, 'asha@test.com');
  assert.equal(me.body.user.passwordHash, undefined, 'the password hash is never sent');
});

test('signup rejects under-18, weak passwords, bad mobile and duplicate email', async () => {
  const ok = { name: 'Asha Roy', email: 'a2@test.com', mobile: '9876543210', password: 'Passw0rd1', age18: true, agreeTerms: true };
  assert.equal((await api().post('/api/auth/signup').send({ ...ok, age18: false })).status, 400);
  assert.equal((await api().post('/api/auth/signup').send({ ...ok, password: 'short' })).status, 400);
  assert.equal((await api().post('/api/auth/signup').send({ ...ok, mobile: '12345' })).status, 400);
  assert.equal((await api().post('/api/auth/signup').send(ok)).status, 200);
  assert.equal((await api().post('/api/auth/signup').send(ok)).status, 409);
});

test('NoSQL injection in login does not log anyone in', async () => {
  await H.makeUser(ctx, { email: 'victim@test.com' });
  for (const body of [{ email: { $ne: null }, password: { $ne: null } }, { email: 'victim@test.com', password: { $ne: 'x' } }, { email: { $regex: '.*' }, password: 'Passw0rd1' }]) {
    const r = await api().post('/api/auth/login').send(body);
    assert.ok([400, 401].includes(r.status), 'status was ' + r.status);
    assert.equal(r.body.token, undefined);
  }
});

test('8 wrong passwords lock the account for 15 minutes (even the right password is refused)', async () => {
  await H.makeUser(ctx, { email: 'lock@test.com' });
  for (let i = 0; i < 8; i++) await api().post('/api/auth/login').send({ email: 'lock@test.com', password: 'wrong' + i });
  const r = await api().post('/api/auth/login').send({ email: 'lock@test.com', password: 'Passw0rd1' });
  assert.equal(r.status, 429);
});

test('changing the password logs out the old token and gives a new one', async () => {
  const u = await H.makeUser(ctx);
  const r = await u.auth(api().put('/api/me/password')).send({ current: 'Passw0rd1', password: 'NewPassw0rd2' });
  assert.equal(r.status, 200); assert.ok(r.body.token);
  assert.equal((await u.auth(api().get('/api/auth/me'))).status, 401, 'old login token must stop working');
  assert.equal((await api().get('/api/auth/me').set('Authorization', 'Bearer ' + r.body.token)).status, 200);
});

test('password reset link works once only and logs out old tokens', async () => {
  const u = await H.makeUser(ctx, { email: 'reset@test.com' });
  await api().post('/api/auth/forgot').send({ email: 'reset@test.com' });
  const mail = H.sentMail.find((m) => m.to === 'reset@test.com'); assert.ok(mail, 'a reset mail was sent');
  const token = /reset=([a-f0-9]+)/.exec(mail.text)[1];
  assert.equal((await api().post('/api/auth/reset').send({ token, password: 'BrandNew123' })).status, 200);
  assert.equal((await api().post('/api/auth/reset').send({ token, password: 'AnotherOne9' })).status, 400, 'second use must fail');
  assert.equal((await u.auth(api().get('/api/auth/me'))).status, 401);
  assert.equal((await api().post('/api/auth/login').send({ email: 'reset@test.com', password: 'BrandNew123' })).status, 200);
});

test('forgot-password answers the same for unknown emails (no email guessing)', async () => {
  const a = await api().post('/api/auth/forgot').send({ email: 'nobody@test.com' });
  assert.equal(a.status, 200); assert.deepEqual(a.body, { ok: true });
});

test('a suspended user is blocked everywhere except /auth/me', async () => {
  const u = await H.makeUser(ctx, { status: 'suspended' });
  assert.equal((await u.auth(api().get('/api/bookings/mine'))).status, 403);
  assert.equal((await u.auth(api().get('/api/auth/me'))).status, 200);
});

test('admin routes need an admin', async () => {
  const u = await H.makeUser(ctx); const a = await H.makeUser(ctx, { admin: true });
  assert.equal((await u.auth(api().get('/api/admin/stats'))).status, 403);
  assert.equal((await api().get('/api/admin/stats')).status, 401);
  assert.equal((await a.auth(api().get('/api/admin/stats'))).status, 200);
});

test('ID documents: owner and admin can open them, other members cannot (and get "not found")', async () => {
  const owner = await H.makeUser(ctx), other = await H.makeUser(ctx), admin = await H.makeUser(ctx, { admin: true });
  const f = await ctx.models.File.create({ owner: owner.user._id, kind: 'id', mime: 'image/png', size: 72, data: H.PNG || Buffer.alloc(72) });
  assert.equal((await owner.auth(api().get('/api/files/' + f._id))).status, 200);
  assert.equal((await other.auth(api().get('/api/files/' + f._id))).status, 404);
  assert.equal((await api().get('/api/files/' + f._id)).status, 401);
  const a = await admin.auth(api().get('/api/files/' + f._id));
  assert.equal(a.status, 200); assert.equal(a.headers['x-content-type-options'], 'nosniff');
  assert.ok(await ctx.models.Audit.findOne({ action: 'view_document' }), 'admin views of ID documents are logged');
});

test('profile photos are visible to verified members only', async () => {
  const owner = await H.makeUser(ctx), member = await H.makeUser(ctx), pending = await H.makeUser(ctx, { status: 'pending' });
  assert.equal((await member.auth(api().get('/api/files/' + owner.user.avatar))).status, 200);
  assert.equal((await pending.auth(api().get('/api/files/' + owner.user.avatar))).status, 404);
});

test('uploads are checked by their real content: a text file renamed .jpg is refused', async () => {
  const u = await H.makeUser(ctx, { photo: false });
  const r = await u.auth(api().post('/api/me/avatar')).attach('photo', Buffer.from('this is not an image at all'), { filename: 'me.jpg', contentType: 'image/jpeg' });
  assert.equal(r.status, 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  assert.equal((await u.auth(api().post('/api/me/avatar')).attach('photo', png, { filename: 'me.png', contentType: 'image/png' })).status, 200);
});

test('a user cannot make themselves admin or verified by sending extra fields', async () => {
  const u = await H.makeUser(ctx, { status: 'incomplete' });
  await u.auth(api().put('/api/me/emergency')).send({ name: 'Dad', mobile: '9000000001', isAdmin: true, status: 'verified' });
  const fresh = await ctx.models.User.findById(u.user._id);
  assert.equal(fresh.isAdmin, false); assert.equal(fresh.status, 'incomplete');
});

test('the public listing never leaks private fields', async () => {
  const comp = await H.makeCompanion(ctx); const renter = await H.makeUser(ctx);
  const r = await renter.auth(api().get('/api/companions'));
  assert.equal(r.status, 200); assert.equal(r.body.list.length, 1);
  const text = JSON.stringify(r.body);
  for (const k of ['passwordHash', 'email', 'mobile', 'dob', 'emergency', 'idFile', 'user1@test.com']) assert.ok(!text.includes(k), 'leaked: ' + k);
});
