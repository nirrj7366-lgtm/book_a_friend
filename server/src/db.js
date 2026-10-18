const mongoose = require('mongoose');
const cfg = require('./config');
const { HttpError } = require('./logic');

async function connect() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(cfg.mongo, { serverSelectionTimeoutMS: 15000 });
  console.log('MongoDB connected');
}

/**
 * Runs fn inside a transaction (MongoDB Atlas supports this). fn receives the session.
 * On a plain local MongoDB (no replica set) transactions do not exist:
 *   - required=false: fn simply runs without one,
 *   - required=true : in production we refuse to run, because the work (for example booking a companion) is only safe inside a transaction.
 */
async function tx(fn, { required = false } = {}) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } catch (e) {
    if (/replica set|Transaction numbers are only allowed/i.test(e.message || '')) {
      if (required && cfg.isProd) throw new HttpError(503, 'The database must support transactions (use MongoDB Atlas).');
      return fn(null);
    }
    throw e;
  } finally {
    session.endSession();
  }
}

module.exports = { connect, tx };
