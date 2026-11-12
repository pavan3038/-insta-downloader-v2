'use strict';
/* Real usage statistics. Counters only – no IP addresses, links, captions or media are stored.
 * Persisted to data/stats.json (debounced). Unique visitors are counted with a per-day salted hash
 * that lives in memory only. */
const crypto = require('crypto');
const storage = require('./storage');

const FILE = 'stats.json';
const KEEP_DAYS = 60, MAX_ERRORS = 100;
const day = () => new Date().toISOString().slice(0, 10);
const blank = () => ({
  since: new Date().toISOString(),
  totals: { requests: 0, success: 0, failed: 0, downloadsStarted: 0, downloadsCompleted: 0, pageViews: 0, feedback: 0, contact: 0 },
  byDay: {}, byMediaType: {}, byMode: {}, byProvider: {}, byErrorCode: {}, errors: [],
});

let data = blank();
let dirty = false, timer = null;
const visitors = new Map(); // day -> Set(hash)
const salt = crypto.randomBytes(16);

function load() {
  try { data = { ...blank(), ...JSON.parse(storage.read(FILE)) }; data.totals = { ...blank().totals, ...data.totals }; }
  catch { data = blank(); }
}
function flush() {
  if (!dirty) return;
  dirty = false;
  storage.write(FILE, JSON.stringify(data));      // falls back to memory by itself when the disk is unavailable
}
function touch() {
  dirty = true;
  if (!timer) { timer = setTimeout(() => { timer = null; flush(); }, 5000); timer.unref(); }
}
function today() {
  const d = day();
  if (!data.byDay[d]) {
    data.byDay[d] = { pageViews: 0, uniqueVisitors: 0, requests: 0, success: 0, failed: 0, downloads: 0 };
    for (const k of Object.keys(data.byDay).sort().slice(0, -KEEP_DAYS)) delete data.byDay[k];
  }
  return data.byDay[d];
}
const inc = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };

function pageView(ip, ua) {
  const d = day(), t = today();
  data.totals.pageViews++; t.pageViews++;
  const h = crypto.createHash('sha256').update(salt).update(d).update(String(ip)).update(String(ua || '')).digest('base64url').slice(0, 16);
  if (!visitors.has(d)) { visitors.clear(); visitors.set(d, new Set()); }
  const set = visitors.get(d);
  if (!set.has(h)) { set.add(h); t.uniqueVisitors++; }
  touch();
}
function request({ ok, mode, mediaType, code }) {
  const t = today();
  data.totals.requests++; t.requests++;
  if (mode) inc(data.byMode, mode);
  if (ok) {
    data.totals.success++; t.success++;
    if (mediaType) inc(data.byMediaType, mediaType);
  } else { data.totals.failed++; t.failed++; if (code) inc(data.byErrorCode, code); }
  touch();
}
function providerResult(name, { ok, latencyMs, code }) {
  const p = data.byProvider[name] || (data.byProvider[name] = { ok: 0, fail: 0, consecutiveFailures: 0, lastOk: null, lastFail: null, lastError: '', lastLatencyMs: 0 });
  const now = new Date().toISOString();
  if (ok) { p.ok++; p.consecutiveFailures = 0; p.lastOk = now; } else { p.fail++; p.consecutiveFailures++; p.lastFail = now; p.lastError = code || 'ERROR'; }
  if (latencyMs != null) p.lastLatencyMs = Math.round(latencyMs);
  touch();
}
function download(done) {
  if (done) { data.totals.downloadsCompleted++; today().downloads++; } else data.totals.downloadsStarted++;
  touch();
}
function count(field) { data.totals[field]++; touch(); }
function pushError(e) {
  data.errors.push({ ts: new Date().toISOString(), ...e });
  if (data.errors.length > MAX_ERRORS) data.errors.splice(0, data.errors.length - MAX_ERRORS);
  touch();
}
function snapshot() {
  const days = Object.keys(data.byDay).sort().slice(-14).map((d) => ({ date: d, ...data.byDay[d] }));
  return JSON.parse(JSON.stringify({ ...data, errors: data.errors.slice().reverse().slice(0, 50), days, byDay: undefined }));
}

load();
process.on('exit', flush);
module.exports = { pageView, request, providerResult, download, count, pushError, snapshot, flush, _reset: () => { data = blank(); dirty = false; } };
