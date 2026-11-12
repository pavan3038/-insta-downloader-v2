'use strict';
/* Rating / feedback / problem reports with server-side validation and basic spam protection. */
const crypto = require('crypto');
const storage = require('./storage');
const { ApiError } = require('./utils');
const { sendJson, readJson, limited } = require('./http');
const stats = require('./stats');
const log = require('./log');

const TYPES = ['rating', 'feedback', 'problem'];
const recent = new Map(); // content hash -> timestamp (duplicate protection, memory only)
const FILE = 'feedback.jsonl';

async function submit(req, res) {
  if (limited(req, 'feedback-attempts', 20, 10 * 60000)) throw new ApiError(429, 'RATE_LIMIT', 'Too many attempts');
  const b = await readJson(req);
  if (b.website) return sendJson(res, 200, { ok: true });                // honeypot: silently accept, store nothing

  const type = String(b.type || '');
  if (!TYPES.includes(type)) throw new ApiError(400, 'INVALID', 'Invalid type');
  const rating = b.rating == null || b.rating === '' ? 0 : Number(b.rating);
  if (rating && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new ApiError(400, 'INVALID', 'Rating must be 1-5');
  if (type === 'rating' && !rating) throw new ApiError(400, 'INVALID', 'Please choose a rating');
  const message = String(b.message || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (type !== 'rating' && message.length < 5) throw new ApiError(400, 'INVALID', 'Message is too short');
  const email = String(b.email || '').trim().slice(0, 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'INVALID', 'Invalid email');

  const elapsed = Number(b.elapsed);                                      // time the form was open (ms) – bots submit instantly
  if (!Number.isFinite(elapsed) || elapsed < 2000) throw new ApiError(400, 'TOO_FAST', 'Please try again');
  if ((message.match(/https?:\/\//gi) || []).length > 2) throw new ApiError(400, 'SPAM', 'Too many links');

  const h = crypto.createHash('sha1').update(type + '|' + message + '|' + rating).digest('hex');
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 3600000) recent.delete(k);
  if (recent.has(h)) return sendJson(res, 200, { ok: true });             // duplicate: accept quietly
  recent.set(h, now);

  if (limited(req, 'feedback-saved', 3, 10 * 60000)) throw new ApiError(429, 'RATE_LIMIT', 'Too many submissions – please try again later');
  const rec = { id: crypto.randomBytes(6).toString('hex'), ts: new Date().toISOString(), type, rating: rating || undefined, message: message || undefined, email: email || undefined };
  storage.append(FILE, JSON.stringify(rec));
  stats.count('feedback');
  log.info('feedback received', { type });
  sendJson(res, 200, { ok: true });
}

/** Last `limit` feedback entries + rating summary (admin only). */
function read(limit = 100) {
  const lines = storage.lines(FILE);
  const all = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const rated = all.filter((x) => x.rating);
  return {
    total: all.length,
    ratingCount: rated.length,
    averageRating: rated.length ? Math.round((rated.reduce((a, x) => a + x.rating, 0) / rated.length) * 10) / 10 : null,
    problems: all.filter((x) => x.type === 'problem').length,
    items: all.slice(-limit).reverse(),
  };
}

module.exports = { submit, read };
