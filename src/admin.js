'use strict';
/* Admin dashboard API (/admin/api/*). Server-side sessions, CSRF token, origin check, login lockout.
 * Credentials live only in environment variables (ADMIN_USER + ADMIN_PASSWORD_HASH); nothing is sent to the browser. */
const crypto = require('crypto');
const fs = require('fs');
const { cfg } = require('./config');
const { ApiError } = require('./utils');
const { sendJson, readJson, parseCookies, isHttps, lockedFor, recordHit, clearHits, limited } = require('./http');
const storage = require('./storage');
const stats = require('./stats');
const feedback = require('./feedback');
const log = require('./log');
const providers = require('./providers');

const COOKIE = 'insta_admin';
const ABSOLUTE_MS = 8 * 3600 * 1000;
const sessions = new Map(); // token -> { csrf, created, last }
const FAIL_MAX = 5, FAIL_WINDOW = 15 * 60000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const configured = () => !!(cfg.admin.user && (cfg.admin.hash || cfg.admin.password.length >= 12));

function verifyPassword(pw) {
  if (cfg.admin.hash) {
    const [scheme, salt, hash] = cfg.admin.hash.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
    const want = Buffer.from(hash, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  return same(pw, cfg.admin.password);
}

function getSession(req) {
  const tok = parseCookies(req)[COOKIE];
  const s = tok && sessions.get(tok);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > ABSOLUTE_MS || now - s.last > cfg.admin.sessionMinutes * 60000) { sessions.delete(tok); return null; }
  s.last = now;
  return { tok, ...s };
}
setInterval(() => { const n = Date.now(); for (const [k, s] of sessions) if (n - s.last > cfg.admin.sessionMinutes * 60000 || n - s.created > ABSOLUTE_MS) sessions.delete(k); }, 60000).unref();

const cookie = (req, value, maxAge) =>
  `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

function checkOrigin(req) {
  const o = req.headers.origin;
  if (o) { let h; try { h = new URL(o).host; } catch { h = ''; } if (h !== req.headers.host) throw new ApiError(403, 'FORBIDDEN', 'Bad origin'); }
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'INVALID', 'JSON required');
}
function requireAuth(req, { csrf } = {}) {
  const s = getSession(req);
  if (!s) throw new ApiError(401, 'UNAUTHORIZED', 'Login required');
  if (csrf) {
    checkOrigin(req);
    const t = String(req.headers['x-csrf-token'] || '');
    if (!t || !same(t, s.csrf)) throw new ApiError(403, 'FORBIDDEN', 'Bad CSRF token');
  }
  return s;
}

async function login(req, res) {
  if (!configured()) throw new ApiError(503, 'ADMIN_DISABLED', 'Admin is not configured on this server');
  checkOrigin(req);
  const wait = lockedFor(req, 'admin-login', FAIL_MAX, FAIL_WINDOW);
  if (wait) return sendJson(res, 429, { error: 'Too many failed attempts', code: 'RATE_LIMIT' }, { 'Retry-After': String(wait) });
  const b = await readJson(req, 2048);
  // evaluate both checks so timing does not reveal which one failed
  const userOk = same(b.user || '', cfg.admin.user);
  const pwOk = verifyPassword(b.password || '');
  if (!(userOk && pwOk)) {
    recordHit(req, 'admin-login');
    log.warn('admin login failed');
    await new Promise((r) => setTimeout(r, 400));
    throw new ApiError(401, 'UNAUTHORIZED', 'Wrong username or password');
  }
  clearHits(req, 'admin-login');
  const tok = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(24).toString('base64url');
  sessions.set(tok, { csrf, created: Date.now(), last: Date.now() });
  log.info('admin login');
  sendJson(res, 200, { ok: true, csrf }, { 'Set-Cookie': cookie(req, tok, ABSOLUTE_MS / 1000) });
}

function logout(req, res) {
  const s = requireAuth(req, { csrf: true });
  sessions.delete(s.tok);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
}


function overview() {
  const snap = stats.snapshot();
  const active = new Set(providers.activeProviders().map((p) => p.name));
  const plist = ['graph', 'rapidapi', 'custom'].map((name) => ({
    name, configured: providers.all.some((p) => p.name === name && p.configured()), active: active.has(name),
    ...(snap.byProvider[name] || { ok: 0, fail: 0, consecutiveFailures: 0, lastOk: null, lastFail: null, lastError: '', lastLatencyMs: 0 }),
  }));
  const t = snap.totals;
  return {
    totals: t,
    successRate: t.requests ? Math.round((t.success / t.requests) * 1000) / 10 : null,
    days: snap.days, byMediaType: snap.byMediaType, byMode: snap.byMode, byErrorCode: snap.byErrorCode,
    providers: plist, errors: snap.errors, since: snap.since,
    system: { uptimeSeconds: Math.round(process.uptime()), node: process.version, memoryMB: Math.round(process.memoryUsage().rss / 1048576), storage: storage.info() },
    feedback: feedback.read(50), contactMessages: storage.lines('messages.jsonl').length,
  };
}

async function healthCheck(req, res) {
  requireAuth(req, { csrf: true });
  if (limited(req, 'admin-health', 6)) throw new ApiError(429, 'RATE_LIMIT', 'Too many checks');
  const results = [];
  for (const p of providers.all) {
    if (!p.configured()) { results.push({ name: p.name, state: 'not_configured' }); continue; }
    if (typeof p.ping !== 'function') { results.push({ name: p.name, state: 'passive', note: 'No free test call exists; health is measured from real requests.' }); continue; }
    const t0 = Date.now();
    try { await p.ping(); stats.providerResult(p.name, { ok: true, latencyMs: Date.now() - t0 }); results.push({ name: p.name, state: 'ok', latencyMs: Date.now() - t0 }); }
    catch (e) { stats.providerResult(p.name, { ok: false, latencyMs: Date.now() - t0, code: e.code }); results.push({ name: p.name, state: 'error', code: e.code || 'ERROR' }); }
  }
  sendJson(res, 200, { results });
}

/** Entry for every /admin/api/* request. `sub` is the path after /admin/api/. */
async function handle(req, res, sub) {
  if (sub === 'status' && req.method === 'GET') {
    const s = getSession(req);
    return sendJson(res, 200, { configured: configured(), loggedIn: !!s, csrf: s ? s.csrf : null });
  }
  if (sub === 'login' && req.method === 'POST') return login(req, res);
  if (sub === 'logout' && req.method === 'POST') return logout(req, res);
  if (sub === 'overview' && req.method === 'GET') { requireAuth(req); return sendJson(res, 200, overview()); }
  if (sub === 'health-check' && req.method === 'POST') return healthCheck(req, res);
  throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint');
}

module.exports = { handle, configured };
