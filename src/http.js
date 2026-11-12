'use strict';
const { cfg } = require('./config');
const { ApiError } = require('./utils');

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};

function sendJson(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false; const chunks = [];
    const to = setTimeout(() => reject(new ApiError(408, 'TIMEOUT', 'Request timed out')), 10000);
    req.on('data', (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
    req.on('error', reject);
    req.on('end', () => {
      clearTimeout(to);
      if (over) return reject(new ApiError(413, 'TOO_LARGE', 'Request too large'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new ApiError(400, 'INVALID', 'Invalid JSON')); }
    });
  });
}

function baseUrl(req) {
  if (cfg.siteUrl) return cfg.siteUrl;
  const host = String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:\-\[\]]/g, '');
  return `${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${host}`;
}

function clientIp(req) {
  if (cfg.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* simple in-memory sliding-window rate limiter */
const hits = new Map();
const windows = new Map();
function limited(req, bucket, max, windowMs = 60000) {
  const key = bucket + '|' + clientIp(req), now = Date.now();
  windows.set(bucket, windowMs);
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
/** Only counts when called (used for failed logins): returns seconds to wait, or 0. */
function lockedFor(req, bucket, max, windowMs) {
  const arr = (hits.get(bucket + '|' + clientIp(req)) || []).filter((t) => Date.now() - t < windowMs);
  return arr.length >= max ? Math.ceil((arr[0] + windowMs - Date.now()) / 1000) : 0;
}
function recordHit(req, bucket) {
  const k = bucket + '|' + clientIp(req); windows.set(bucket, windows.get(bucket) || 15 * 60000);
  const a = hits.get(k) || []; a.push(Date.now()); hits.set(k, a);
}
function clearHits(req, bucket) { hits.delete(bucket + '|' + clientIp(req)); }
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) { const w = windows.get(k.split('|')[0]) || 60000; if (!v.some((t) => n - t < w)) hits.delete(k); } }, 60000).unref();

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) {
  return !!req.socket.encrypted || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https') || cfg.siteUrl.startsWith('https://');
}

module.exports = { SEC_HEADERS, sendJson, readJson, baseUrl, clientIp, limited, lockedFor, recordHit, clearHits, parseCookies, isHttps };
