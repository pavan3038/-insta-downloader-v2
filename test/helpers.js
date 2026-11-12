'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const CLEAR = ['IG_ACCESS_TOKEN', 'CUSTOM_API_URL', 'CUSTOM_VIDEO_PATH', 'RAPIDAPI_KEY', 'RAPIDAPI_HOST', 'RAPIDAPI_BASE', 'ENV_FILE',
  'ADMIN_USER', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'PROVIDER', 'DATA_DIR', 'SITE_URL', 'ALLOW_PRIVATE_HOSTS'];

/** Starts the real server in a child process with an isolated data dir. */
function run(port, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insta-data-'));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'error', ...extra };
  for (const k of CLEAR) if (!(k in extra) && k !== 'DATA_DIR') delete env[k];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve) => {
    child.stdout.on('data', (d) => { if (String(d).includes('running')) resolve({ child, base: `http://127.0.0.1:${port}`, dataDir, stop() { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } }); });
  });
}
const post = (base, p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const reel = (c) => ({ url: `https://www.instagram.com/reel/${c}/?igsh=abc` });
module.exports = { run, post, reel };
