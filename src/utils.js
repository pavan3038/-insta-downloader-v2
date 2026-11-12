'use strict';
const net = require('net');
const dns = require('dns').promises;
const { cfg } = require('./config');

class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra || null; }
}

/** Accepts Reel, Post (/p/), IGTV and Story links. Returns null when not an Instagram media link. */
function parseInstagramUrl(input) {
  if (typeof input !== 'string' || input.length > 300) return null;
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host !== 'instagram.com' && host !== 'instagr.am') return null;

  const st = u.pathname.match(/^\/stories\/([A-Za-z0-9._]+)\/(\d{5,25})/);
  if (st) return { type: 'story', username: st[1], shortcode: st[2], canonical: `https://www.instagram.com/stories/${st[1]}/${st[2]}/` };

  const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,})/);
  if (!m) return null;
  const kind = m[1] === 'reels' ? 'reel' : m[1];
  return { type: kind === 'p' ? 'post' : kind === 'tv' ? 'igtv' : 'reel', shortcode: m[2], canonical: `https://www.instagram.com/${kind}/${m[2]}/` };
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(l);
  }
  return true;
}

/** SSRF guard: only public https hosts may be fetched on the user's behalf. */
async function assertPublicUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new ApiError(502, 'UPSTREAM', 'Bad media URL'); }
  if (cfg.allowPrivate) return u;
  if (u.protocol !== 'https:') throw new ApiError(502, 'UPSTREAM', 'Media URL must be https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new ApiError(502, 'UPSTREAM', 'Blocked media host');
  return u;
}

/** fetch with manual redirects (each hop re-checked) and a header timeout. */
async function safeFetch(url, init = {}, { timeout = 20000, maxRedirects = 3 } = {}) {
  let cur = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(cur);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try { res = await fetch(cur, { ...init, redirect: 'manual', signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      controller.abort();
      cur = new URL(res.headers.get('location'), cur).href;
      continue;
    }
    return { res, controller };
  }
  throw new ApiError(502, 'UPSTREAM', 'Too many redirects');
}

/** JSON API call with friendly error mapping and one automatic retry for transient failures. */
async function jsonFetch(url, init = {}, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    try { return await jsonFetchOnce(url, init); }
    catch (e) {
      const transient = e instanceof ApiError && e.code === 'UPSTREAM';
      if (!transient || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
async function jsonFetchOnce(url, init) {
  let res;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }); }
  catch { throw new ApiError(502, 'UPSTREAM', 'API service unreachable'); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const code = data && data.error && data.error.code;
    if (res.status === 401 || code === 190) throw new ApiError(502, 'TOKEN_INVALID', 'API key/token invalid or expired');
    if (res.status === 403) throw new ApiError(502, 'TOKEN_INVALID', 'API key rejected or subscription missing (HTTP 403)');
    if (res.status === 404) throw new ApiError(404, 'NOT_FOUND', 'Video not found');
    if (res.status === 429) throw new ApiError(429, 'RATE_LIMIT', 'Upstream rate limit / quota reached');
    throw new ApiError(502, 'UPSTREAM', 'API service error (' + res.status + ')');
  }
  if (data === null) throw new ApiError(502, 'UPSTREAM', 'API returned invalid JSON');
  return data;
}

/** pick(obj,"a.b.0.c,x.y") – first non-empty string among comma-separated dot paths. */
function pick(obj, spec) {
  for (const p of String(spec || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    let v = obj;
    for (const k of p.split('.')) { if (v == null) break; v = v[k]; }
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

const shortTitle = (s) => (s ? String(s).split('\n')[0].trim().slice(0, 120) : '');

module.exports = { ApiError, parseInstagramUrl, isPrivateIp, assertPublicUrl, safeFetch, jsonFetch, pick, shortTitle };
