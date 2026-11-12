'use strict';
/* v2 features: photos, carousels, quality variants, stats, feedback, admin security, PWA files. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mock = require('./mock-apis');
const { run, post, reel } = require('./helpers');

let m;
before(async () => { m = await mock.start(4610); });
after(() => m.server.close());

const graphEnv = () => ({ ALLOW_PRIVATE_HOSTS: '1', IG_ACCESS_TOKEN: 'GOOD_TOKEN', IG_API_BASE: m.origin + '/v21.0' });
const salt = crypto.randomBytes(16);
const PW = 'correct horse battery';
const HASH = 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(PW, salt, 64).toString('hex');
const adminEnv = { ADMIN_USER: 'boss', ADMIN_PASSWORD_HASH: HASH };

async function login(s, pw = PW) {
  const r = await post(s.base, '/admin/api/login', { user: 'boss', password: pw });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie, csrf: r.ok ? (await r.json()).csrf : null };
}
const getOverview = (s, cookie) => fetch(s.base + '/admin/api/overview', { headers: cookie ? { Cookie: cookie } : {} });

test('photo, carousel and video items from the official API (with sizes and per-item downloads)', async () => {
  const s = await run(4611, graphEnv());
  try {
    let j = await (await post(s.base, '/api/resolve', { url: 'https://www.instagram.com/p/IMAGEonly1/' })).json();
    assert.equal(j.kind, 'photo'); assert.equal(j.items.length, 1); assert.equal(j.items[0].type, 'image');
    assert.ok(j.items[0].size > 0, 'file size comes from the media host');
    const d = await fetch(s.base + j.items[0].download);
    assert.equal(d.headers.get('content-type'), 'image/jpeg');
    assert.match(d.headers.get('content-disposition'), /insta-IMAGEonly1\.jpg/);

    j = await (await post(s.base, '/api/resolve', { url: 'https://www.instagram.com/p/CAROUSEL01/', mode: 'photo' })).json();
    assert.equal(j.kind, 'carousel'); assert.deepEqual(j.items.map((i) => i.type), ['image', 'image', 'video']);
    const names = [];
    for (const it of j.items) names.push((await fetch(s.base + it.download)).headers.get('content-disposition').match(/filename="([^"]+)"/)[1]);
    assert.deepEqual(names, ['insta-CAROUSEL01-1.jpg', 'insta-CAROUSEL01-2.jpg', 'insta-CAROUSEL01-3.mp4']);
    assert.equal((await fetch(s.base + `/api/download/${j.id}/7`)).status, 404);
  } finally { s.stop(); }
});

test('quality variants, duration and resolution are passed through only when the API provides them', async () => {
  const s = await run(4612, { ALLOW_PRIVATE_HOSTS: '1', RAPIDAPI_KEY: 'RKEY', RAPIDAPI_HOST: 'ig.p.rapidapi.com', RAPIDAPI_BASE: m.origin + '/rapid', RAPIDAPI_ENDPOINT: '/convert?url={url}' });
  try {
    const j = await (await post(s.base, '/api/resolve', reel('VARIANTS1'))).json();
    const it = j.items[0];
    assert.equal(it.variants.length, 2); assert.equal(it.height, 1280); assert.equal(it.duration, 12.5);
    assert.ok(it.variants.every((v) => v.url === undefined), 'variant source URLs are never exposed');
    assert.equal((await fetch(s.base + it.download + '?q=0')).status, 200);
    assert.equal((await fetch(s.base + it.download + '?q=9')).status, 404);
    // an API that gives no metadata -> zeros, not invented numbers
    const r2 = await (await post(s.base, '/api/resolve', reel('AbCdEf123'))).json();
    assert.equal(r2.items[0].duration, 0); assert.equal(r2.items[0].variants.length, 0);
  } finally { s.stop(); }
});

test('statistics are real counts and visible only to a logged-in admin', async () => {
  const s = await run(4613, { ...graphEnv(), PROVIDER: 'graph', ...adminEnv });
  try {
    await fetch(s.base + '/');                                                         // 1 page view
    await post(s.base, '/api/resolve', { ...reel('OWNreel123'), mode: 'video' });     // success
    const ok = await (await post(s.base, '/api/resolve', { url: 'https://www.instagram.com/p/IMAGEonly1/', mode: 'photo' })).json();
    await post(s.base, '/api/resolve', { url: 'nonsense', mode: 'all' });             // INVALID_URL
    await post(s.base, '/api/resolve', { ...reel('OtherUser1'), mode: 'all' });       // NOT_OWNED
    await (await fetch(s.base + ok.items[0].download)).arrayBuffer();                 // 1 completed download
    await new Promise((r) => setTimeout(r, 100));

    const { cookie } = await login(s);
    const o = await (await getOverview(s, cookie)).json();
    assert.equal(o.totals.requests, 4); assert.equal(o.totals.success, 2); assert.equal(o.totals.failed, 2);
    assert.equal(o.successRate, 50);
    assert.deepEqual(o.byErrorCode, { INVALID_URL: 1, NOT_OWNED: 1 });
    assert.deepEqual(o.byMode, { video: 1, photo: 1, all: 2 });
    assert.deepEqual(o.byMediaType, { video: 1, photo: 1 });
    assert.equal(o.totals.downloadsStarted, 1); assert.equal(o.totals.downloadsCompleted, 1);
    assert.equal(o.totals.pageViews, 1); assert.equal(o.days.at(-1).uniqueVisitors, 1);
    const g = o.providers.find((p) => p.name === 'graph');
    assert.equal(g.configured, true); assert.equal(g.ok, 4 - 1 /* INVALID_URL never reaches a provider */); assert.equal(g.fail, 0);
    assert.equal(JSON.stringify(o).includes('GOOD_TOKEN'), false, 'secrets are never returned');
  } finally { s.stop(); }
});

test('admin security: auth, sessions, CSRF, origin check, lockout, headers', async () => {
  const off = await run(4614, {});
  try {
    assert.equal((await post(off.base, '/admin/api/login', { user: 'a', password: 'b' })).status, 503);
    assert.equal((await getOverview(off)).status, 401);
    assert.equal((await (await fetch(off.base + '/admin/api/status')).json()).configured, false);
  } finally { off.stop(); }

  const s = await run(4615, { ...graphEnv(), ...adminEnv, ADMIN_SESSION_MINUTES: '30' });
  try {
    for (const p of ['/admin/api/overview']) assert.equal((await fetch(s.base + p)).status, 401);
    assert.equal((await post(s.base, '/admin/api/health-check', {})).status, 401);
    assert.equal((await post(s.base, '/admin/api/logout', {})).status, 401);

    const page = await fetch(s.base + '/admin');
    const html = await page.text();
    assert.equal(page.status, 200); assert.match(page.headers.get('x-robots-tag'), /noindex/); assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(!html.includes(HASH) && !html.includes(PW) && !html.includes('boss'));
    assert.match(await (await fetch(s.base + '/robots.txt')).text(), /Disallow: \/admin/);
    assert.ok(!(await (await fetch(s.base + '/sitemap.xml')).text()).includes('admin'));

    assert.equal((await login(s, 'wrong password')).r.status, 401);
    const good = await login(s);
    assert.equal(good.r.status, 200);
    const sc = good.r.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/admin/);
    assert.equal(good.r.headers.get('cache-control'), 'no-store');
    assert.equal((await getOverview(s, good.cookie)).status, 200);
    assert.equal((await getOverview(s, 'insta_admin=forged')).status, 401);

    // state-changing calls need the CSRF token and a same-origin request
    const hdr = { Cookie: good.cookie };
    assert.equal((await post(s.base, '/admin/api/health-check', {}, hdr)).status, 403);
    assert.equal((await post(s.base, '/admin/api/health-check', {}, { ...hdr, 'X-CSRF-Token': 'nope' })).status, 403);
    assert.equal((await post(s.base, '/admin/api/health-check', {}, { ...hdr, 'X-CSRF-Token': good.csrf, Origin: 'https://evil.example' })).status, 403);
    const hc = await post(s.base, '/admin/api/health-check', {}, { ...hdr, 'X-CSRF-Token': good.csrf });
    assert.equal(hc.status, 200);
    const res = (await hc.json()).results;
    assert.equal(res.find((r) => r.name === 'graph').state, 'ok');
    assert.equal(res.find((r) => r.name === 'rapidapi').state, 'not_configured');

    assert.equal((await post(s.base, '/admin/api/logout', {}, { ...hdr, 'X-CSRF-Token': good.csrf })).status, 200);
    assert.equal((await getOverview(s, good.cookie)).status, 401, 'session is destroyed server-side');
  } finally { s.stop(); }

  const lock = await run(4616, adminEnv);
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await login(lock, 'bad password ' + i)).r.status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429]);
    const blocked = await login(lock);                       // even the right password is refused during lockout
    assert.equal(blocked.r.status, 429); assert.ok(Number(blocked.r.headers.get('retry-after')) > 0);
  } finally { lock.stop(); }
});

test('feedback: validation, spam protection, admin summary', async () => {
  const s = await run(4617, adminEnv);
  const send = (b) => post(s.base, '/api/feedback', { elapsed: 5000, ...b });
  try {
    assert.equal((await send({ type: 'rating', rating: 6 })).status, 400);
    assert.equal((await send({ type: 'rating' })).status, 400);
    assert.equal((await send({ type: 'weird', rating: 3 })).status, 400);
    assert.equal((await send({ type: 'problem', message: 'bad' })).status, 400);
    assert.equal((await send({ type: 'feedback', message: 'Nice site', email: 'not-an-email' })).status, 400);
    assert.equal((await send({ type: 'feedback', message: 'buy http://a.io http://b.io http://c.io' })).status, 400);
    assert.equal((await post(s.base, '/api/feedback', { type: 'rating', rating: 5, elapsed: 300 })).status, 400, 'bot-fast submit');
    assert.equal((await send({ type: 'rating', rating: 5, website: 'http://spam' })).status, 200);   // honeypot: accepted silently…
    assert.equal(fs.existsSync(path.join(s.dataDir, 'feedback.jsonl')), false);                      // …but never stored

    assert.equal((await send({ type: 'rating', rating: 5, message: 'Love it' })).status, 200);
    assert.equal((await send({ type: 'rating', rating: 5, message: 'Love it' })).status, 200);       // duplicate -> not stored twice
    const lines = fs.readFileSync(path.join(s.dataDir, 'feedback.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal((await send({ type: 'problem', message: 'Download stops at 90%', rating: 2 })).status, 200);
    assert.equal((await send({ type: 'feedback', message: 'A third message' })).status, 200);
    assert.equal((await send({ type: 'feedback', message: 'A fourth message' })).status, 429, 'rate limit: 3 saved submissions per 10 minutes');

    const { cookie } = await login(s);
    const o = await (await getOverview(s, cookie)).json();
    assert.equal(o.feedback.total, 3); assert.equal(o.feedback.averageRating, 3.5); assert.equal(o.feedback.problems, 1);
    assert.equal(o.totals.feedback, 3);
  } finally { s.stop(); }
});

test('PWA files, offline page, admin page and 404 are served correctly', async () => {
  const s = await run(4630, {});
  try {
    const m = await fetch(s.base + '/manifest.webmanifest'); assert.equal(m.status, 200);
    const mj = await m.json(); assert.equal(mj.display, 'standalone');
    for (const ic of mj.icons) assert.equal((await fetch(s.base + ic.src)).status, 200, ic.src);
    const sw = await fetch(s.base + '/sw.js'); assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/);
    const off = await fetch(s.base + '/offline'); assert.equal(off.status, 200); assert.match(off.headers.get('x-robots-tag') || '', /noindex/);
    const ad = await fetch(s.base + '/admin'); assert.equal(ad.status, 200); assert.match(ad.headers.get('x-robots-tag') || '', /noindex/);
    assert.equal((await fetch(s.base + '/no-such-page')).status, 404);
    assert.equal((await fetch(s.base + '/img/og.jpg')).status, 200);
  } finally { s.stop(); }
});

test('RapidAPI: quality options with real sizes, audio-only download and format info', async () => {
  const s = await run(4631, { ALLOW_PRIVATE_HOSTS: '1', RAPIDAPI_KEY: 'RKEY', RAPIDAPI_HOST: 'ig.p.rapidapi.com', RAPIDAPI_BASE: m.origin + '/rapid', RAPIDAPI_ENDPOINT: '/convert?url={url}' });
  try {
    const j = await (await post(s.base, '/api/resolve', reel('WITHAUDIO1'))).json();
    const it = j.items[0];
    assert.equal(it.type, 'video'); assert.equal(it.variants.length, 2);
    assert.deepEqual(it.variants.map((v) => v.label), ['1080p', '540p']);                 // best first
    assert.ok(it.variants.every((v) => v.size > 0), 'sizes come from the media host');
    assert.equal(it.format, 'mp4');
    assert.ok(it.audio && it.audio.size === 200 * 1024 + 5 && it.audio.format === 'mp3', JSON.stringify(it.audio));
    assert.ok(!JSON.stringify(j).includes('/cdn/'), 'source URLs are never exposed');
    const a = await fetch(s.base + it.audio.download);
    assert.equal(a.status, 200); assert.equal(a.headers.get('content-type'), 'audio/mpeg');
    assert.match(a.headers.get('content-disposition'), /insta-WITHAUDIO1-audio\.mp3/);
    assert.equal((await a.arrayBuffer()).byteLength, 200 * 1024 + 5);
    // an item without audio exposes none, and ?a=1 on it is a clean 404
    const j2 = await (await post(s.base, '/api/resolve', reel('VARIANTS1'))).json();
    assert.equal(j2.items[0].audio, null);
    assert.equal((await fetch(s.base + j2.items[0].download + '?a=1')).status, 404);
  } finally { s.stop(); }
});

test('storage: falls back to ./data / temp / memory and never crashes on a bad DATA_DIR', async () => {
  const bad = await run(4632, { DATA_DIR: '/proc/definitely/not/writable' });
  try {
    const st = await (await fetch(bad.base + '/api/health')).json(); assert.equal(st.ok, true);
    const r = await post(bad.base, '/api/contact', { name: 'A', email: 'a@example.com', message: 'hello there' });
    assert.equal(r.status, 200, 'contact form still works');
    const fb = await post(bad.base, '/api/feedback', { type: 'feedback', message: 'works without disk', elapsed: 9000 });
    assert.equal(fb.status, 200);
  } finally { bad.stop(); }
  const unset = await run(4633, { DATA_DIR: '' });
  try { assert.equal((await fetch(unset.base + '/api/health')).status, 200); } finally { unset.stop(); }
  const storage = require('../src/storage');
  assert.ok(['configured', 'local', 'temp', 'memory'].includes(storage.info().mode));
});
