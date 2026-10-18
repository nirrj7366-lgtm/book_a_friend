const router = require('express').Router();
const bcrypt = require('bcryptjs');
const cfg = require('../config');
const { User, Companion } = require('../models');
const { ah, signToken, authAllowSuspended, limiter } = require('../middleware');
const { bad, isEmail, isMobile, strongPw, randomToken, sha } = require('../util');
const { sendMail } = require('../mailer');

// A throw-away hash, so a login for an unknown email takes as long as a real one (no way to guess which emails exist by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 11);
const MAX_FAILS = 8, LOCK_MS = 15 * 60 * 1000;

const ipLimit = limiter(15 * 60 * 1000, 60, 'Too many attempts. Please try again in a few minutes.');
const emailKey = (req) => 'e:' + String((req.body && req.body.email) || '').toLowerCase().slice(0, 120);
const emailLimit = limiter(15 * 60 * 1000, 15, 'Too many attempts for this email. Please try again in a few minutes.', emailKey);

/** The safe view of a user that is sent to the browser (no hashes, tokens or document ids). */
const publicUser = (u) => ({
  _id: u._id, email: u.email, name: u.name, mobile: u.mobile, mobileVerified: u.mobileVerified,
  dob: u.dob, gender: u.gender, state: u.state, city: u.city, idType: u.idType,
  avatar: u.avatar || null, gallery: u.gallery || [], emergencyName: u.emergencyName, emergencyMobile: u.emergencyMobile,
  status: u.status, rejectReason: u.rejectReason, isAdmin: u.isAdmin, deletionRequested: u.deletionRequested, hasId: !!u.idFile,
});

router.post('/signup', ipLimit, emailLimit, ah(async (req, res) => {
  const { name, email, mobile, password, age18, agreeTerms } = req.body || {};
  if (!name || String(name).trim().length < 3 || String(name).length > 80) bad('Please enter your full name.');
  if (!isEmail(email)) bad('Enter a valid email address.');
  if (!isMobile(mobile)) bad('Enter a valid 10-digit Indian mobile number.');
  if (!strongPw(password)) bad('Password needs 8+ characters with a letter and a number.');
  if (age18 !== true && age18 !== 'true') bad('You must confirm that you are 18 or older.');
  if (agreeTerms !== true && agreeTerms !== 'true') bad('Please accept the Terms and Privacy Policy.');

  const user = new User({ name: String(name).trim(), email: String(email).trim(), mobile: String(mobile), passwordHash: await bcrypt.hash(password, 11), emailVerified: !cfg.requireEmailVerify });
  let token = null;
  if (cfg.requireEmailVerify) { token = randomToken(); user.verifyToken = sha(token); }
  try { await user.save(); }
  catch (e) { if (e.code === 11000) bad('An account with this email already exists. Please log in.', 409); throw e; }
  if (cfg.requireEmailVerify) {
    await sendMail(user.email, 'Confirm your Yaari account', `Welcome to Yaari!\n\nPlease confirm your email by opening this link:\n${cfg.appUrl}/?verify=${token}\n`);
    return res.json({ needsVerify: true });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/verify-email', ipLimit, ah(async (req, res) => {
  const t = String((req.body || {}).token || '');
  const u = t ? await User.findOne({ verifyToken: sha(t) }).select('+verifyToken') : null;
  if (!u) bad('This link is not valid any more.');
  u.emailVerified = true; u.verifyToken = undefined; await u.save();
  res.json({ ok: true });
}));

router.post('/login', ipLimit, emailLimit, ah(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const u = await User.findOne({ email }).select('+passwordHash +failedLogins +lockUntil');
  if (u && u.lockUntil && u.lockUntil > new Date()) bad('Too many wrong attempts. Please try again in 15 minutes or reset your password.', 429);
  const good = await bcrypt.compare(password, u ? u.passwordHash || DUMMY_HASH : DUMMY_HASH);
  if (!u || !good) {
    if (u) {
      const after = await User.findOneAndUpdate({ _id: u._id }, { $inc: { failedLogins: 1 } }, { new: true }).select('+failedLogins');
      if (after.failedLogins >= MAX_FAILS) await User.updateOne({ _id: u._id }, { $set: { failedLogins: 0, lockUntil: new Date(Date.now() + LOCK_MS) } });
    }
    bad('Wrong email or password.', 401);
  }
  if (!u.emailVerified) bad('Please confirm your email first. Check your inbox.', 403);
  if (u.failedLogins || u.lockUntil) await User.updateOne({ _id: u._id }, { $set: { failedLogins: 0 }, $unset: { lockUntil: 1 } });
  res.json({ token: signToken(u), user: publicUser(u) });
}));

router.post('/forgot', ipLimit, emailLimit, ah(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const u = isEmail(email) ? await User.findOne({ email }) : null;
  if (u) {
    const t = randomToken();
    await User.updateOne({ _id: u._id }, { $set: { resetToken: sha(t), resetExpires: new Date(Date.now() + 3600e3) } });
    try { await sendMail(u.email, 'Reset your Yaari password', `Open this link to choose a new password (valid for 1 hour):\n${cfg.appUrl}/?reset=${t}\n\nIf you did not ask for this, ignore this email.`); }
    catch (e) { console.error('reset mail failed:', e.message); }
  }
  res.json({ ok: true }); // same answer whether or not the email exists
}));

router.post('/reset', ipLimit, ah(async (req, res) => {
  const { token, password } = req.body || {};
  if (!strongPw(password)) bad('Password needs 8+ characters with a letter and a number.');
  const t = String(token || '');
  const hash = await bcrypt.hash(password, 11);
  // one atomic step: the link can be used only once, and every old login stops working
  const u = t && await User.findOneAndUpdate(
    { resetToken: sha(t), resetExpires: { $gt: new Date() } },
    { $set: { passwordHash: hash, failedLogins: 0 }, $unset: { resetToken: 1, resetExpires: 1, lockUntil: 1 }, $inc: { tokenVersion: 1 } },
    { new: true },
  );
  if (!u) bad('This link has expired. Please ask for a new one.');
  res.json({ ok: true });
}));

router.get('/me', authAllowSuspended, ah(async (req, res) => {
  const comp = await Companion.findOne({ user: req.user._id }).select('-lockSeq').lean();
  res.json({ user: publicUser(req.user), companion: comp });
}));

module.exports = { router, publicUser };
