const jwt = require('jsonwebtoken');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const cfg = require('./config');
const { User } = require('./models');
const { HttpError, sanitizeDeep, detectMime } = require('./logic');

/** Wraps async route handlers so errors reach the error handler. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** The token carries the user's tokenVersion: changing a password raises it and kills every old login. */
const signToken = (user) => jwt.sign({ id: String(user._id), v: user.tokenVersion || 0 }, cfg.jwtSecret, { expiresIn: '30d' });

function makeAuth(allowSuspended) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : null;
      if (!t) throw new HttpError(401, 'Please log in');
      let p;
      try { p = jwt.verify(t, cfg.jwtSecret); } catch { throw new HttpError(401, 'Please log in again'); }
      const u = await User.findById(p.id);
      if (!u || (u.tokenVersion || 0) !== (p.v || 0)) throw new HttpError(401, 'Please log in again');
      if (u.status === 'suspended' && !allowSuspended) throw new HttpError(403, 'Your account is on hold. Please contact Yaari support.');
      req.user = u;
      next();
    } catch (e) { next(e); }
  };
}
const auth = makeAuth(false);
const authAllowSuspended = makeAuth(true);

const verified = (req, res, next) => (req.user.status === 'verified' ? next() : next(new HttpError(403, 'Your account is not verified yet')));
const admin = (req, res, next) => (req.user.isAdmin ? next() : next(new HttpError(403, 'Admins only')));

/** Strips "$operator" keys and dotted keys from body, query and params (blocks NoSQL injection). */
const sanitize = (req, res, next) => { sanitizeDeep(req.body); sanitizeDeep(req.query); sanitizeDeep(req.params); next(); };

const limiter = (windowMs, limit, message, keyGenerator) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: message },
  ...(keyGenerator ? { keyGenerator, validate: false } : {}),
});
const byUser = (req) => String(req.user ? req.user._id : req.ip);

/** Photos/documents: size limit here, real type check (magic bytes) in checkFile(). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 2, fields: 30 } });

/** Returns the real mime type of an uploaded file, or throws if it is not one of the allowed types. */
function checkFile(file, allowed, label = 'file') {
  const real = detectMime(file.buffer);
  if (!real || !allowed.includes(real)) throw new HttpError(400, `This ${label} is not a valid ${allowed.map((m) => m.split('/')[1].toUpperCase()).join('/')} file.`);
  return real;
}

const errorHandler = (err, req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB)' : 'Upload failed' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message)[0] });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Bad request' });
  if (err.code === 11000) return res.status(409).json({ error: 'This already exists' });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

module.exports = { ah, signToken, auth, authAllowSuspended, verified, admin, sanitize, limiter, byUser, upload, checkFile, errorHandler };
