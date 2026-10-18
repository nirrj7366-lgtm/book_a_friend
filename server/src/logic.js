/* Pure business rules (no database, no network). Everything here is unit-tested: see server/test/unit */
const crypto = require('crypto');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

const VENUES = {
  'Shopping': ['Mall / Market', 'Cafe / Restaurant'],
  'Movie': ['Cinema hall', 'Cafe / Restaurant'],
  'Club & Party': ['Registered club / lounge', 'Banquet / Party venue'],
  'Wedding': ['Wedding venue / Banquet'],
  'Study': ['Library / Study cafe', 'Cafe / Restaurant'],
  'Play': ['Sports ground / Park', 'Gaming cafe / Arcade', 'Board-game cafe'],
  'Caretaker': ['Home (verified caretakers only)', 'Hospital / Clinic', 'Park (walks)'],
};
const SERVICES = Object.keys(VENUES);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const istDay = (d) => DAYS[new Date(new Date(d).getTime() + 330 * 60000).getUTCDay()];

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

const ageOf = (dob, now = new Date()) => {
  const b = new Date(dob), t = new Date(now);
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
};

/** "18-25" or "46-" -> the range of birth dates for that age group. */
const ageRange = (key, now = new Date()) => {
  const m = /^(\d{1,3})-(\d{0,3})$/.exec(String(key || '')); if (!m) return null;
  const min = +m[1], max = m[2] ? +m[2] : null;
  const latest = new Date(now.getFullYear() - min, now.getMonth(), now.getDate());
  const earliest = max === null ? new Date(1900, 0, 1) : new Date(now.getFullYear() - max - 1, now.getMonth(), now.getDate() + 1);
  return { $gte: earliest, $lte: latest };
};

/** All money maths. Whole rupees, same rounding everywhere. */
const money = (rate, hours, s) => {
  const gross = rate * hours;
  const fee = Math.round(gross * s.feePct / 100);
  const commission = Math.round(gross * s.commissionPct / 100);
  return { gross, fee, commission, net: gross - commission, total: gross + fee };
};

const isMobile = (v) => /^[6-9]\d{9}$/.test(String(v || ''));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '')) && String(v).length <= 120;
const strongPw = (v) => typeof v === 'string' && v.length <= 200 && /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(v);
const isUpi = (v) => /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/.test(String(v || ''));

/** Chat safety: no phone numbers, links or payment apps. Returns a message if blocked, else null. */
function chatProblem(body) {
  if (/(\d[\s.\-]?){10,}/.test(body)) return 'For safety, phone numbers cannot be shared in chat. Please keep talking on Yaari.';
  if (/(https?:\/\/|www\.|[a-z0-9._-]+@[a-z]+|\b(whatsapp|telegram|upi|paytm|gpay|phonepe|instagram|snapchat)\b)/i.test(body)) return 'For safety, links, payment details and other apps cannot be shared in chat.';
  return null;
}

const hmacHex = (secret, msg) => crypto.createHmac('sha256', String(secret)).update(String(msg)).digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const randomToken = () => crypto.randomBytes(32).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomCode4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** Looks at the first bytes of a file, so a renamed .exe cannot pass as a photo. */
function detectMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Two bookings clash if one starts before the other ends (and the other starts before this one ends). */
const overlaps = (aStart, aHours, bStart, bHours) => {
  const a0 = +new Date(aStart), a1 = a0 + aHours * 3600e3, b0 = +new Date(bStart), b1 = b0 + bHours * 3600e3;
  return a0 < b1 && b0 < a1;
};

/** Who may refund which booking status. */
const REFUND_PARTY = ['paid', 'accepted', 'refund_pending'];
const REFUND_ADMIN = ['paid', 'accepted', 'in_progress', 'refund_pending'];
const refundStatuses = (isAdmin) => (isAdmin ? REFUND_ADMIN : REFUND_PARTY);

const shouldAutoRelease = (b, now = Date.now()) => b.status === 'in_progress' && !b.disputed && +new Date(b.startsAt) + b.hours * 3600e3 + 24 * 3600e3 < now;
/** A paid request nobody answered before the meeting time, or a confirmed meeting that never started: refund the renter. */
const shouldRefundUnanswered = (b, now = Date.now()) =>
  (b.status === 'paid' && +new Date(b.startsAt) < now) ||
  (b.status === 'accepted' && +new Date(b.startsAt) + b.hours * 3600e3 + 24 * 3600e3 < now);

/** Removes MongoDB operators ("$ne") and dotted keys from user input, in place. */
function sanitizeDeep(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return o;
  for (const k of Object.keys(o)) {
    if (k.startsWith('$') || k.includes('.')) delete o[k];
    else sanitizeDeep(o[k], depth + 1);
  }
  return o;
}

const firstName = (n) => String(n || '').trim().split(/\s+/)[0];

module.exports = { HttpError, bad, VENUES, SERVICES, DAYS, STATES, istDay, ageOf, ageRange, money, isMobile, isEmail, strongPw, isUpi, chatProblem, hmacHex, safeEqual, randomToken, sha, randomCode4, detectMime, overlaps, refundStatuses, REFUND_PARTY, REFUND_ADMIN, shouldAutoRelease, shouldRefundUnanswered, sanitizeDeep, firstName };
