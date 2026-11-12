'use strict';
/* Configuration from environment variables / .env. The .env file is re-read automatically
 * when it changes, so adding an API key removes the "API not configured" banner without a restart. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = process.env.ENV_FILE || path.join(ROOT, '.env');
const externalKeys = new Set(Object.keys(process.env)); // real environment always wins over .env
let fileKeys = new Set();
let lastMtime = -1;

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function applyEnvFile() {
  const parsed = parseEnvFile(ENV_FILE);
  for (const k of fileKeys) if (!(k in parsed) && !externalKeys.has(k)) delete process.env[k];
  fileKeys = new Set();
  for (const [k, v] of Object.entries(parsed)) {
    if (externalKeys.has(k)) continue;
    process.env[k] = v; fileKeys.add(k);
  }
}

function build(env) {
  const int = (v, d) => parseInt(v, 10) || d;
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    siteUrl: (env.SITE_URL || '').replace(/\/+$/, ''),
    trustProxy: env.TRUST_PROXY === '1',
    rateLimit: int(env.RATE_LIMIT_PER_MIN, 20),
    allowPrivate: env.ALLOW_PRIVATE_HOSTS === '1', // local testing only
    provider: (env.PROVIDER || 'auto').toLowerCase(), // auto | graph | rapidapi | custom
    graph: {
      token: env.IG_ACCESS_TOKEN || '',
      base: (env.IG_API_BASE || 'https://graph.instagram.com/v21.0').replace(/\/+$/, ''),
      maxPages: int(env.IG_MAX_PAGES, 10),
    },
    rapidapi: {
      key: env.RAPIDAPI_KEY || '',
      host: env.RAPIDAPI_HOST || '',
      base: (env.RAPIDAPI_BASE || '').replace(/\/+$/, ''), // optional override (tests)
      endpoint: env.RAPIDAPI_ENDPOINT || '/?url={url}',
      method: (env.RAPIDAPI_METHOD || 'GET').toUpperCase(),
      body: env.RAPIDAPI_BODY || '',
      video: env.RAPIDAPI_VIDEO_PATH || '', // optional: auto-detected when empty
      thumb: env.RAPIDAPI_THUMB_PATH || '',
      audio: env.RAPIDAPI_AUDIO_PATH || '', // optional: auto-detected when the API returns an audio file
      title: env.RAPIDAPI_TITLE_PATH || '',
    },
    custom: {
      url: env.CUSTOM_API_URL || '', method: (env.CUSTOM_API_METHOD || 'GET').toUpperCase(),
      headers: env.CUSTOM_API_HEADERS || '', body: env.CUSTOM_API_BODY || '',
      video: env.CUSTOM_VIDEO_PATH || '', thumb: env.CUSTOM_THUMB_PATH || '', audio: env.CUSTOM_AUDIO_PATH || '', title: env.CUSTOM_TITLE_PATH || '',
    },
    dataDir: env.DATA_DIR || '',          // empty = ./data (see src/storage.js for the fallback chain)
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
    admin: {
      user: env.ADMIN_USER || '',
      hash: env.ADMIN_PASSWORD_HASH || '',       // scrypt hash – create with: npm run admin:hash
      password: env.ADMIN_PASSWORD || '',        // plain fallback (min 12 chars) – hash is preferred
      sessionMinutes: parseInt(env.ADMIN_SESSION_MINUTES, 10) || 30,
    },
  };
}

const cfg = {};
function reload(force) {
  let m = -1;
  try { m = fs.statSync(ENV_FILE).mtimeMs; } catch { /* no .env file */ }
  if (!force && m === lastMtime) return;
  lastMtime = m;
  applyEnvFile();
  Object.assign(cfg, build(process.env));
}
reload(true);

module.exports = { cfg, reload, ROOT };
