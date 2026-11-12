'use strict';
/* Persistent storage with a safe fallback chain, so the app never crashes because of a disk problem.
 *   1. DATA_DIR from .env (point it at a Render/VPS persistent disk, e.g. /var/data)
 *   2. ./data inside the project (when DATA_DIR is not set or not writable)
 *   3. the OS temp directory
 *   4. memory only (data is lost on restart, the site keeps working)
 * Every read/write is wrapped, so a full or read-only disk degrades to memory instead of throwing. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cfg } = require('./config');

const ROOT = path.join(__dirname, '..');
const mem = new Map();          // name -> string (used as a mirror when the disk is unavailable)
let dir = null, mode = 'memory', note = '';

/** mkdir -p, one level at a time (a recursive mkdir can hang on special mounts such as /proc). */
function mkdirs(d) {
  const parts = path.resolve(d).split(path.sep); let cur = path.sep;
  for (const part of parts) {
    if (!part) continue;
    cur = path.join(cur, part);
    try { fs.mkdirSync(cur); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}
function writable(d) {
  try { mkdirs(d); const t = path.join(d, '.w' + process.pid); fs.writeFileSync(t, 'ok'); fs.unlinkSync(t); return true; }
  catch { return false; }
}
function init() {
  const wanted = cfg.dataDir;
  const candidates = [[wanted, wanted ? 'configured' : ''], [path.join(ROOT, 'data'), 'local'], [path.join(os.tmpdir(), 'insta-downloader-data'), 'temp']];
  const seen = new Set();
  for (const [d, m] of candidates) {
    if (!d || seen.has(d)) continue; seen.add(d);
    if (writable(d)) {
      dir = d; mode = m || 'local';
      note = wanted && d !== wanted ? `DATA_DIR "${wanted}" is not writable – using ${d}` : '';
      return;
    }
  }
  dir = null; mode = 'memory'; note = 'No writable folder found – data is kept in memory only';
}
init();

const file = (name) => (dir ? path.join(dir, name) : null);

function read(name) {
  const f = file(name);
  if (f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') dir = null; } }
  return mem.get(name) || '';
}
function write(name, text) {
  const f = file(name);
  if (f) {
    try { fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); return true; }
    catch { dir = null; mode = 'memory'; note = 'Disk write failed – continuing in memory'; }
  }
  mem.set(name, text); return false;
}
function append(name, line) {
  const f = file(name);
  if (f) { try { fs.appendFileSync(f, line + '\n'); return true; } catch { dir = null; mode = 'memory'; note = 'Disk write failed – continuing in memory'; } }
  mem.set(name, (mem.get(name) || '') + line + '\n'); return false;
}
const lines = (name) => read(name).split('\n').filter(Boolean);
const info = () => ({ mode, persistent: mode === 'configured' || mode === 'local', dir, note });

module.exports = { read, write, append, lines, info };
