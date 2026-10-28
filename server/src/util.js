const cfg = require('./config');
const { Settings } = require('./models');
const logic = require('./logic');

async function getSettings() {
  let s = await Settings.findOne({ key: 'main' });

  if (!s) {
    try {
      s = await Settings.create({ key: 'main' });
    } catch (e) {
      if (e.code === 11000) {
        s = await Settings.findOne({ key: 'main' });
      } else {
        throw e;
      }
    }
  }

  const defaults = {
    commissionPct: 15,
    feePct: 5,
    minWithdrawal: 500,
    minHourlyRate: 1,
    maxHourlyRate: 10000,
  };

  let changed = false;

  for (const [key, value] of Object.entries(defaults)) {
    if (s[key] == null) {
      s[key] = value;
      changed = true;
    }
  }

  if (changed) {
    await s.save();
  }

  return s;
}

/** Calls the Razorpay REST API (15 second limit). Errors become readable HttpErrors. */
async function razorpay(path, body) {
  if (!cfg.rz.keyId || !cfg.rz.keySecret) throw new logic.HttpError(503, 'Payments are not set up yet (Razorpay keys missing).');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(cfg.rz.base + path, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Basic ' + Buffer.from(cfg.rz.keyId + ':' + cfg.rz.keySecret).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { throw new logic.HttpError(502, 'Could not reach Razorpay. Please try again.'); } finally { clearTimeout(t); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new logic.HttpError(502, (out.error && out.error.description) || 'Razorpay error'); e.razorpay = out.error; throw e; }
  return out;
}

module.exports = { ...logic, getSettings, razorpay };
