'use strict';
/* Run: npm test   (uses Node's built-in test runner; no dependencies) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const mock = require('./mock-apis');

const MOCK_PORT = 4510;
let m;
before(async () => { m = await mock.start(MOCK_PORT); });
after(() => m.server.close());

function run(port, extra) {
  const contact = path.join(os.tmpdir(), `contact-data-${port}`, 'messages.jsonl');
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(os.tmpdir(), `contact-data-${port}`), ...extra };
  for (const k of ['IG_ACCESS_TOKEN', 'CUSTOM_API_URL', 'CUSTOM_VIDEO_PATH', 'RAPIDAPI_KEY', 'RAPIDAPI_HOST', 'RAPIDAPI_BASE', 'ENV_FILE']) if (!(k in extra)) delete env[k];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => {
    child.stdout.on('data', (d) => { if (String(d).includes('running')) resolve({ child, base: `http://127.0.0.1:${port}`, contact }); });
  });
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const reel = (c) => ({ url: `https://www.instagram.com/reel/${c}/?igsh=abc` });

test('no provider configured -> clear NO_PROVIDER error, status says so', async () => {
  const s = await run(4511, {});
  try {
    assert.equal((await (await fetch(s.base + '/api/status')).json()).configured, false);
    const r = await post(s.base, '/api/resolve', reel('OWNreel123'));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, 'NO_PROVIDER');
    const bad = await post(s.base, '/api/resolve', { url: 'https://example.com/reel/abcdef/' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'INVALID_URL');
  } finally { s.child.kill(); }
});

test('graph + custom providers, proxy download, range, errors', async () => {
  const s = await run(4512, {
    ALLOW_PRIVATE_HOSTS: '1', IG_ACCESS_TOKEN: 'GOOD_TOKEN', IG_API_BASE: m.origin + '/v21.0',
    CUSTOM_API_URL: m.origin + '/provider?url={url}', CUSTOM_API_HEADERS: '{"X-Api-Key":"KEY123"}',
    CUSTOM_VIDEO_PATH: 'data.medias.0.url', CUSTOM_THUMB_PATH: 'data.thumb', CUSTOM_TITLE_PATH: 'data.title',
  });
  try {
    // own reel via official (graph) provider
    let r = await post(s.base, '/api/resolve', reel('OWNreel123'));
    let j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.source, 'graph'); assert.equal(j.title, 'My own reel'); 

    // download = exact original bytes + attachment header
    const d = await fetch(s.base + j.items[0].download);
    assert.equal(d.status, 200);
    assert.match(d.headers.get('content-disposition'), /attachment; filename="insta-OWNreel123\.mp4"/);
    assert.equal(d.headers.get('content-type'), 'video/mp4');
    const buf = Buffer.from(await d.arrayBuffer());
    assert.equal(buf.length, m.VIDEO.length); assert.ok(buf.equals(m.VIDEO));

    // preview supports Range
    const rg = await fetch(s.base + j.items[0].preview, { headers: { Range: 'bytes=10-19' } });
    assert.equal(rg.status, 206); assert.equal((await rg.arrayBuffer()).byteLength, 10);
    assert.equal(rg.headers.get('content-disposition'), null);

    // thumbnail
    const th = await fetch(s.base + j.items[0].thumbnail);
    assert.equal(th.headers.get('content-type'), 'image/png');

    // reel on page 2 of graph results
    j = await (await post(s.base, '/api/resolve', reel('PAGE2video'))).json();
    assert.equal(j.source, 'graph');

    // not in account -> falls back to custom provider
    j = await (await post(s.base, '/api/resolve', reel('OtherUser1'))).json();
    assert.equal(j.source, 'custom'); assert.equal(j.title, 'Provider video');

    // nowhere to be found
    r = await post(s.base, '/api/resolve', reel('MISSING01'));
    assert.equal(r.status, 404); assert.equal((await r.json()).code, 'NOT_FOUND');

    // media host answering with HTML is refused
    r = await post(s.base, '/api/resolve', reel('BADhtml99'));
    j = await r.json();
    const bad = await fetch(s.base + j.items[0].download);
    assert.equal(bad.status, 502);

    // unknown / expired id
    assert.equal((await fetch(s.base + '/api/download/doesnotexist1')).status, 404);
  } finally { s.child.kill(); }
});

test('invalid graph token -> TOKEN_INVALID', async () => {
  const s = await run(4513, { ALLOW_PRIVATE_HOSTS: '1', IG_ACCESS_TOKEN: 'EXPIRED', IG_API_BASE: m.origin + '/v21.0', PROVIDER: 'graph' });
  try {
    const r = await post(s.base, '/api/resolve', reel('OWNreel123'));
    assert.equal(r.status, 502); assert.equal((await r.json()).code, 'TOKEN_INVALID');
  } finally { s.child.kill(); }
});

test('graph only: video of another account -> NOT_OWNED', async () => {
  const s = await run(4514, { ALLOW_PRIVATE_HOSTS: '1', IG_ACCESS_TOKEN: 'GOOD_TOKEN', IG_API_BASE: m.origin + '/v21.0' });
  try {
    const r = await post(s.base, '/api/resolve', reel('OtherUser1'));
    assert.equal(r.status, 404); assert.equal((await r.json()).code, 'NOT_OWNED');
  } finally { s.child.kill(); }
});

test('SSRF guard: private media hosts are blocked by default', async () => {
  const s = await run(4515, { IG_ACCESS_TOKEN: 'GOOD_TOKEN', IG_API_BASE: m.origin + '/v21.0' }); // ALLOW_PRIVATE_HOSTS off
  try {
    const r = await post(s.base, '/api/resolve', reel('OWNreel123'));
    assert.equal(r.status, 502);
  } finally { s.child.kill(); }
});

test('pages, SEO files, security headers, contact form, rate limit', async () => {
  const s = await run(4516, { RATE_LIMIT_PER_MIN: '3', SITE_URL: 'https://example.test' });
  try {
    for (const p of ['/', '/about', '/contact', '/privacy', '/terms', '/js/app.js', '/style.css', '/img/favicon.svg', '/ads.txt', '/sitemap.xml', '/robots.txt']) {
      assert.equal((await fetch(s.base + p)).status, 200, p);
    }
    const home = await fetch(s.base + '/');
    const html = await home.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/">/);
    assert.match(html, /Insta Downloader/); assert.ok(!html.includes('<!--@header-->'));
    assert.ok(home.headers.get('content-security-policy').includes("default-src 'self'"));
    assert.equal((await fetch(s.base + '/nope')).status, 404);
    assert.equal((await fetch(s.base + '/js/../../server.js')).status, 404);
    assert.equal((await fetch(s.base + '/index.html.bak')).status, 404);

    let r = await post(s.base, '/api/contact', { name: 'A', email: 'bad', message: 'x' });
    assert.equal(r.status, 400);
    r = await post(s.base, '/api/contact', { name: 'Asha', email: 'asha@example.com', message: 'Hello' });
    assert.equal(r.status, 200);
    assert.match(fs.readFileSync(s.contact, 'utf8'), /asha@example\.com/);

    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post(s.base, '/api/resolve', { url: 'x' })).status);
    assert.deepEqual(codes.slice(0, 3), [400, 400, 400]); assert.equal(codes[4], 429);
  } finally { s.child.kill(); { s.child.kill('SIGKILL'); fs.rmSync(path.dirname(s.contact), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }; }
});

test('RapidAPI provider: reel, post, story via auto-detected JSON; key errors; quota', async () => {
  const s = await run(4517, { ALLOW_PRIVATE_HOSTS: '1', RAPIDAPI_KEY: 'RKEY', RAPIDAPI_HOST: 'ig.p.rapidapi.com',
    RAPIDAPI_BASE: m.origin + '/rapid', RAPIDAPI_ENDPOINT: '/convert?url={url}' });
  try {
    assert.deepEqual((await (await fetch(s.base + '/api/status')).json()), { configured: true, providers: ['rapidapi'] });
    for (const [link, type, title, file] of [
      ['https://www.instagram.com/reel/AbCdEf123/', 'reel', 'Rapid reel', 'insta-AbCdEf123.mp4'],
      ['https://www.instagram.com/p/PostCode99/', 'post', 'Rapid post', 'insta-PostCode99.mp4'],
      ['https://www.instagram.com/stories/someone/3412345678901/', 'story', 'Rapid story', 'insta-story-3412345678901.mp4'],
    ]) {
      const r = await post(s.base, '/api/resolve', { url: link });
      const j = await r.json();
      assert.equal(r.status, 200, link); assert.equal(j.type, type); assert.equal(j.title, title)
      assert.ok(j.items[0].thumbnail);
      const d = await fetch(s.base + j.items[0].download);
      assert.equal(Buffer.from(await d.arrayBuffer()).length, m.VIDEO.length);
    }
    let r = await post(s.base, '/api/resolve', reel('MISSING01'));
    assert.equal(r.status, 404); assert.equal((await r.json()).code, 'NOT_FOUND');
    r = await post(s.base, '/api/resolve', reel('QUOTA0001'));
    assert.equal(r.status, 429); assert.equal((await r.json()).code, 'RATE_LIMIT');
  } finally { s.child.kill(); }

  const bad = await run(4518, { ALLOW_PRIVATE_HOSTS: '1', RAPIDAPI_KEY: 'WRONG', RAPIDAPI_HOST: 'ig.p.rapidapi.com',
    RAPIDAPI_BASE: m.origin + '/rapid', RAPIDAPI_ENDPOINT: '/convert?url={url}' });
  try {
    const r = await post(bad.base, '/api/resolve', reel('AbCdEf123'));
    assert.equal(r.status, 502); assert.equal((await r.json()).code, 'TOKEN_INVALID');
  } finally { bad.child.kill(); }
});

test('graph provider serves own Stories', async () => {
  const s = await run(4519, { ALLOW_PRIVATE_HOSTS: '1', IG_ACCESS_TOKEN: 'GOOD_TOKEN', IG_API_BASE: m.origin + '/v21.0' });
  try {
    const r = await post(s.base, '/api/resolve', { url: 'https://www.instagram.com/stories/me/17900000000001/' });
    const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.type, 'story'); assert.equal(j.source, 'graph');
  } finally { s.child.kill(); }
});

test('adding an API key to .env removes the "not configured" state without a restart', async () => {
  const envFile = path.join(os.tmpdir(), 'insta-test.env');
  fs.writeFileSync(envFile, 'PORT=4520\n');
  const s = await run(4520, { ENV_FILE: envFile });
  try {
    assert.equal((await (await fetch(s.base + '/api/status')).json()).configured, false);
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(envFile, 'RAPIDAPI_KEY=RKEY\nRAPIDAPI_HOST=ig.p.rapidapi.com\n');
    const st = await (await fetch(s.base + '/api/status')).json();
    assert.equal(st.configured, true); assert.deepEqual(st.providers, ['rapidapi']);
    fs.writeFileSync(envFile, 'PORT=4520\n');
    assert.equal((await (await fetch(s.base + '/api/status')).json()).configured, false);
  } finally { s.child.kill(); fs.rmSync(envFile, { force: true }); }
});
