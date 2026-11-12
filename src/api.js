'use strict';
/* /api/* route handlers */
const { Readable } = require('stream');
const { cfg } = require('./config');
const { ApiError, parseInstagramUrl, assertPublicUrl, safeFetch } = require('./utils');
const { SEC_HEADERS, sendJson, readJson, limited } = require('./http');
const { activeProviders } = require('./providers');
const { putEntry, getEntry } = require('./store');
const { probeInfo } = require('./media');
const storage = require('./storage');
const stats = require('./stats');
const log = require('./log');

const RANK = (e) => (e.code === 'NOT_OWNED' ? 0 : e.code === 'NOT_FOUND' ? 1 : 2);
const MODES = ['all', 'video', 'photo', 'story'];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm' };
const extOf = (u) => { const m = String(u).split('?')[0].toLowerCase().match(/\.([a-z0-9]{2,5})$/); return m ? m[1].replace('jpeg', 'jpg') : ''; };

function status(req, res) {
  const ps = activeProviders();
  sendJson(res, 200, { configured: ps.length > 0, providers: ps.map((p) => p.name) });
}

const health = (req, res) => sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });

async function resolve(req, res) {
  if (limited(req, 'resolve', cfg.rateLimit)) throw new ApiError(429, 'RATE_LIMIT', 'Too many requests');
  const body = await readJson(req);
  const mode = MODES.includes(body.mode) ? body.mode : 'all';
  let outcome = { ok: false, mode, code: 'INTERNAL' };
  try {
    const parsed = parseInstagramUrl(body.url);
    if (!parsed) throw new ApiError(400, 'INVALID_URL', 'Not a valid Instagram Reel / Post / Story link');
    const providers = activeProviders();
    if (!providers.length) throw new ApiError(503, 'NO_PROVIDER', 'No API key is configured on this server');

    let lastErr = null, found = null, source = '';
    for (const p of providers) {
      const t0 = Date.now();
      try { found = await p.resolve(parsed); source = p.name; stats.providerResult(p.name, { ok: true, latencyMs: Date.now() - t0 }); break; }
      catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(502, 'UPSTREAM', 'API error');
        // "not found / not yours" is a normal answer, not a provider outage
        const outage = !['NOT_OWNED', 'NOT_FOUND'].includes(err.code);
        stats.providerResult(p.name, { ok: !outage, latencyMs: Date.now() - t0, code: err.code });
        if (outage) log.warn('provider error', { provider: p.name, code: err.code });
        if (!lastErr || RANK(err) >= RANK(lastErr)) lastErr = err;
      }
    }
    if (!found) throw lastErr;

    // keep only media on public https hosts (SSRF guard)
    const items = [];
    for (const it of found.items) {
      try { await assertPublicUrl(it.url); items.push(it); } catch { log.warn('blocked media host'); }
    }
    if (!items.length) throw new ApiError(502, 'UPSTREAM', 'Media host is not allowed');

    // audio-only files: kept only when the provider really returned one on a public host
    for (const it of items) {
      if (!it.audio) continue;
      try { await assertPublicUrl(it.audio.url); } catch { delete it.audio; }
    }
    // real file size + format from the media host (not guessed)
    await Promise.all(items.slice(0, 12).map(async (it) => {
      const info = await probeInfo(it.url);
      if (!it.size) it.size = info.size;
      it.format = EXT[info.type] || extOf(it.url) || '';
      if (it.audio) { const a = await probeInfo(it.audio.url); it.audio.size = a.size; it.audio.format = EXT[a.type] || it.audio.format || ''; }
    }));
    // quality options: real sizes for every variant (up to 4)
    await Promise.all(items.flatMap((it) => (it.variants || []).slice(0, 4).filter((v) => !v.size).map(async (v) => { try { await assertPublicUrl(v.url); v.size = (await probeInfo(v.url)).size; } catch { /* unknown */ } })));

    const id = putEntry({ shortcode: parsed.shortcode, story: parsed.type === 'story', items });
    const kind = items.length > 1 ? 'carousel' : items[0].type === 'video' ? 'video' : 'photo';
    outcome = { ok: true, mode, mediaType: parsed.type === 'story' ? 'story' : kind };
    sendJson(res, 200, {
      id, source, type: parsed.type, kind, shortcode: parsed.shortcode, title: found.title,
      items: items.map((it, i) => ({
        index: i, type: it.type,
        thumbnail: it.thumb || it.type === 'image' ? `/api/thumb/${id}/${i}` : null,
        preview: `/api/stream/${id}/${i}`,
        download: `/api/download/${id}/${i}`,
        width: it.width || 0, height: it.height || 0, duration: it.duration || 0, size: it.size || 0, format: it.format || '',
        audio: it.audio ? { download: `/api/download/${id}/${i}?a=1`, size: it.audio.size || 0, format: it.audio.format || '' } : null,
        variants: (it.variants || []).map((v, q) => ({ q, label: v.label, width: v.width || 0, height: v.height || 0, size: v.size || 0 })),
      })),
    });
  } catch (e) {
    outcome = { ok: false, mode, code: e instanceof ApiError ? e.code : 'INTERNAL' };
    throw e;
  } finally { stats.request(outcome); }
}

/** Streams media untouched (original quality), with Range support for the preview player. */
async function media(req, res, id, kind, index, variant, audio) {
  const e = getEntry(id);
  if (!e) throw new ApiError(404, 'EXPIRED', 'Link expired');
  const item = e.items[index || 0];
  if (!item) throw new ApiError(404, 'NOT_FOUND', 'No such item');
  let target = item.url;
  if (audio) { if (!item.audio) throw new ApiError(404, 'NOT_FOUND', 'No audio for this item'); target = item.audio.url; }
  else if (kind === 'thumb') target = item.thumb || (item.type === 'image' ? item.url : '');
  else if (variant != null) { const v = (item.variants || [])[variant]; if (!v) throw new ApiError(404, 'NOT_FOUND', 'No such quality'); target = v.url; }
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Not available');
  await assertPublicUrl(target);

  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; InstaDownloader/2.0)' };
  if (kind !== 'thumb' && req.headers.range) headers.range = req.headers.range;

  let up;
  try { up = await safeFetch(target, { headers }); }
  catch (err) { throw err instanceof ApiError ? err : new ApiError(502, 'UPSTREAM', 'Could not fetch media'); }
  const { res: r, controller } = up;
  if (!(r.ok || r.status === 206) || !r.body) { controller.abort(); throw new ApiError(502, 'UPSTREAM', 'Media host returned ' + r.status); }

  let ct = (r.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  const wantImage = !audio && (kind === 'thumb' || item.type === 'image');
  const out = { ...SEC_HEADERS, 'Cache-Control': 'private, max-age=600' };
  if (wantImage) {
    if (!ct.startsWith('image/')) { controller.abort(); throw new ApiError(502, 'UPSTREAM', 'Media host did not return an image'); }
  } else {
    if (ct.startsWith('text/') || ct.includes('json') || ct.includes('html')) { controller.abort(); throw new ApiError(502, 'UPSTREAM', 'Media host did not return a video'); }
    if (audio) { if (!ct.startsWith('audio/') && ct !== 'application/octet-stream' && !ct.startsWith('video/')) { controller.abort(); throw new ApiError(502, 'UPSTREAM', 'Media host did not return audio'); } if (!ct.startsWith('audio/')) ct = ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' })[extOf(target)] || 'audio/mp4'; }
    else if (!ct.startsWith('video/')) ct = 'video/mp4';
    out['Accept-Ranges'] = 'bytes';
  }
  out['Content-Type'] = ct;
  for (const h of ['content-length', 'content-range']) { const v = r.headers.get(h); if (v) out[h] = v; }

  if (kind === 'download') {
    const n = e.items.length > 1 ? `-${(index || 0) + 1}` : '';
    const name = `insta-${e.story ? 'story-' : ''}${e.shortcode}${n}${audio ? '-audio' : ''}.${EXT[ct] || extOf(target) || (audio ? 'm4a' : wantImage ? 'jpg' : 'mp4')}`;
    out['Content-Disposition'] = `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    stats.download(false);
    res.on('finish', () => stats.download(true));
  }
  res.writeHead(r.status, out);
  if (req.method === 'HEAD') { controller.abort(); return res.end(); }
  res.on('close', () => controller.abort());
  Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
}

async function contact(req, res) {
  if (limited(req, 'contact', 5)) throw new ApiError(429, 'RATE_LIMIT', 'Too many requests');
  const b = await readJson(req);
  if (b.website) return sendJson(res, 200, { ok: true }); // honeypot
  const name = String(b.name || '').trim().slice(0, 100), email = String(b.email || '').trim().slice(0, 200), message = String(b.message || '').trim().slice(0, 3000);
  if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'INVALID', 'Please fill all fields correctly');
  storage.append('messages.jsonl', JSON.stringify({ ts: new Date().toISOString(), name, email, message }));
  stats.count('contact');
  sendJson(res, 200, { ok: true });
}

module.exports = { status, health, resolve, media, contact };
