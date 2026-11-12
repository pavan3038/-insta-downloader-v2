'use strict';
/**
 * Turns an API response into a normalised list of media items:
 *   { type:'video'|'image', url, thumb, width, height, duration, size, label, variants:[{url,label,width,height,size}] }
 * Only what the API actually returned is filled in – nothing is invented.
 */
const { safeFetch } = require('./utils');

const URL_RE = /^https?:\/\/[^\s]+$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/;
const IMG_EXT = /\.(jpe?g|png|webp|heic|gif)$/;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav)$/;
const AUDIO_KEY = /^(audio|mp3|audio_?(url|link|src)|mp3_?(url|link)|music_?(url|link))$/i;
const THUMB_KEY = /thumb|cover|poster|preview|still|placeholder/i;
const IGNORE_KEY = /avatar|profile|music|audio|sound|logo|icon|permalink|share_url|owner|favicon/i;   // (audio is handled separately, see audioOf)
const VARIANT_ARRAY_KEY = /candidates|versions|resolutions|sources|formats|qualities|variants|renditions/i;
const MAX_ITEMS = 20;

/** Only real audio files count: an audio-looking key or file extension. Nothing is converted or invented. */
function isAudio(key, url) {
  if (!URL_RE.test(url)) return false;
  let host; try { host = new URL(url).hostname; } catch { return false; }
  if (/(^|\.)instagram\.com$/.test(host)) return false;
  return AUDIO_EXT.test(url.split('?')[0].toLowerCase()) || AUDIO_KEY.test(key);
}
const audioFormat = (url) => { const m = url.split('?')[0].toLowerCase().match(/\.(mp3|m4a|aac|ogg|opus|wav)$/); return m ? m[1] : ''; };

function classify(key, url, hint) {
  if (isAudio(key, url)) return 'audio';
  if (IGNORE_KEY.test(key)) return 'ignore';
  let host;
  try { host = new URL(url).hostname; } catch { return 'ignore'; }
  if (/(^|\.)instagram\.com$/.test(host)) return 'ignore'; // page links, not media files
  if (THUMB_KEY.test(key)) return 'thumb';
  const p = url.split('?')[0].toLowerCase();
  if (VIDEO_EXT.test(p)) return 'video';
  if (IMG_EXT.test(p)) return 'image';
  if (/video|mp4|play_?url/i.test(key)) return 'video';
  if (/image|photo|picture|display|(^|_)pic(_|$)|img/i.test(key)) return 'image';
  if (/^(url|src|link|download_?url|media_?url|media|hd|sd|high|low)$/i.test(key)) {
    if (/video/i.test(hint)) return 'video';
    if (/image|photo|pic/i.test(hint)) return 'image';
  }
  return 'unknown';
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const str = (v) => (typeof v === 'string' && v.length < 40 ? v : '');
const rankKey = (k) => (/hd|high|original|best|max/i.test(k) ? 0 : /video_?url|^url$|^src$|play/i.test(k) ? 1 : /sd|low|small/i.test(k) ? 3 : 2);

function metaOf(o) {
  let duration = num(o.duration || o.video_duration || o.duration_sec || o.length);
  if (duration > 10000) duration = duration / 1000; // some APIs send milliseconds
  return {
    width: num(o.width || o.original_width), height: num(o.height || o.original_height), duration,
    size: num(o.size || o.filesize || o.file_size || o.bytes), label: str(o.quality || o.label || o.resolution || o.definition || o.format_note),
  };
}

function objectItem(o) {
  const hint = String(o.type || o.media_type || o.__typename || o.kind || '');
  const vids = [], imgs = []; let thumb = '', audio = null;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string' || !URL_RE.test(v)) continue;
    const c = classify(k, v, hint);
    if (c === 'audio') { if (!audio) audio = { url: v, format: audioFormat(v), size: 0 }; continue; }
    if (c === 'video') vids.push([k, v]); else if (c === 'image') imgs.push([k, v]); else if (c === 'thumb' && !thumb) thumb = v;
  }
  const meta = metaOf(o);
  if (vids.length) {
    vids.sort((a, b) => rankKey(a[0]) - rankKey(b[0]));
    const uniq = []; const seen = new Set();
    for (const [k, u] of vids) if (!seen.has(u)) { seen.add(u); uniq.push([k, u]); }
    const item = { type: 'video', url: uniq[0][1], thumb: thumb || (imgs[0] && imgs[0][1]) || '', ...meta };
    if (audio) item.audio = audio;
    if (uniq.length > 1 && uniq.some(([k]) => /hd|sd|high|low|\d{3,4}p/i.test(k))) {
      item.variants = uniq.map(([k, u]) => ({ url: u, label: k.replace(/[_-]?(video|url|src)/gi, '').toUpperCase() || k, width: 0, height: 0, size: 0 }));
    }
    return item;
  }
  if (imgs.length) {
    imgs.sort((a, b) => rankKey(a[0]) - rankKey(b[0]));
    return { type: 'image', url: imgs[0][1], thumb: '', ...meta };
  }
  if (audio) return { type: 'audio', url: audio.url, audio, thumb: '', width: 0, height: 0, duration: metaOf(o).duration, size: 0, label: '' };
  return null;
}

function mergeVariants(list) {
  const sorted = list.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || (b.width || 0) - (a.width || 0));
  const best = sorted[0];
  return { ...best, thumb: best.thumb || (sorted.find((x) => x.thumb) || {}).thumb || '',
    variants: sorted.map((v) => ({ url: v.url, label: v.label || (v.height ? v.height + 'p' : v.width ? v.width + 'px' : ''), width: v.width, height: v.height, size: v.size })) };
}

function walk(v, depth, key) {
  if (depth > 9 || v == null || typeof v !== 'object') return [];
  if (Array.isArray(v)) {
    const per = v.slice(0, 40).map((x) => walk(x, depth + 1, ''));
    const oneEach = per.length >= 2 && per.every((a) => a.length === 1 && a[0].type === per[0][0].type);
    if (oneEach && (VARIANT_ARRAY_KEY.test(key) || (per[0][0].type === 'video' && per.every((a) => a[0].label)))) return [mergeVariants(per.map((a) => a[0]))];
    return per.flat();
  }
  const own = objectItem(v);
  const kids = [];
  for (const k of Object.keys(v)) if (v[k] && typeof v[k] === 'object') kids.push(...walk(v[k], depth + 1, k));
  if (!own) {
    // metadata (duration, size…) often sits on the parent object next to the media list
    const videos = kids.filter((x) => x.type === 'video');
    if (videos.length === 1) {
      const meta = metaOf(v);
      if (!videos[0].duration && meta.duration) videos[0].duration = meta.duration;
    }
  }
  return own ? [own, ...kids] : kids;
}

function findTitle(data) {
  let title = '';
  (function scan(v, d) {
    if (title || d > 6 || v == null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && /^(caption|title|text|description)$/i.test(k) && x.length < 2000 && !URL_RE.test(x)) { title = x; return; }
    }
    for (const x of Object.values(v)) scan(x, d + 1);
  })(data, 0);
  return title;
}

function extractMedia(data) {
  const seen = new Set(), all = [];
  for (const it of walk(data, 0, '')) {
    if (seen.has(it.url)) continue;
    seen.add(it.url); all.push(it);
  }
  // A stand-alone audio file is attached only when there is exactly one video to belong to (never guessed for carousels)
  const items = all.filter((i) => i.type !== 'audio'), audios = all.filter((i) => i.type === 'audio');
  const vids = items.filter((i) => i.type === 'video');
  if (audios.length && vids.length === 1 && !vids[0].audio) vids[0].audio = audios[0].audio;
  const thumbs = new Set(items.map((i) => i.thumb).filter(Boolean));
  return { items: items.filter((i) => !(i.type === 'image' && thumbs.has(i.url))).slice(0, MAX_ITEMS), title: findTitle(data) };
}

/** Best-effort file size (HEAD, then a 1-byte range request). Returns 0 when the host does not say. */
async function probeSize(url) { return (await probeInfo(url)).size; }

/** { size, type } from the media host (0 / '' when it does not say). */
async function probeInfo(url) {
  const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; InstaDownloader/2.0)' };
  try {
    const h = await safeFetch(url, { method: 'HEAD', headers: UA }, { timeout: 3500 });
    const len = Number(h.res.headers.get('content-length')) || 0, type = (h.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    h.controller.abort();
    if (h.res.ok && len) return { size: len, type };
    const g = await safeFetch(url, { headers: { ...UA, Range: 'bytes=0-0' } }, { timeout: 3500 });
    const m = (g.res.headers.get('content-range') || '').match(/\/(\d+)$/), t2 = (g.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    g.controller.abort();
    return { size: m ? Number(m[1]) : 0, type: t2 || type };
  } catch { return { size: 0, type: '' }; }
}

module.exports = { extractMedia, probeSize, probeInfo, audioFormat, MAX_ITEMS };
