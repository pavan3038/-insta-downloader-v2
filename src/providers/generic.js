'use strict';
/* Shared HTTP-JSON API caller used by the RapidAPI and Custom providers. */
const { ApiError, jsonFetch, pick, shortTitle } = require('../utils');
const { extractMedia, audioFormat } = require('../media');

function fillTemplate(s, parsed, encode) {
  return String(s)
    .replace(/\{url\}/g, encode ? encodeURIComponent(parsed.canonical) : parsed.canonical)
    .replace(/\{shortcode\}/g, parsed.shortcode)
    .replace(/\{username\}/g, parsed.username || '');
}

/**
 * spec = { url, method, headers (object), body (string template), video, thumb, title }
 * Returns { title, items }. If spec.video (a dot-path) is set and found, that single video is used;
 * otherwise the JSON response is scanned for videos / photos / carousel items (see src/media.js).
 */
async function callApi(spec, parsed) {
  const init = { method: spec.method || 'GET', headers: { Accept: 'application/json', ...(spec.headers || {}) } };
  if (init.method !== 'GET' && spec.body) {
    init.body = fillTemplate(spec.body, parsed, false);
    if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  }
  const data = await jsonFetch(fillTemplate(spec.url, parsed, true), init);

  let items = [], title = pick(data, spec.title);
  const forced = pick(data, spec.video);
  if (/^https?:\/\//i.test(forced)) items = [{ type: 'video', url: forced, thumb: pick(data, spec.thumb) }];
  else { const found = extractMedia(data); items = found.items; title = title || found.title; }
  const aud = pick(data, spec.audio);                       // optional explicit audio field (RAPIDAPI_AUDIO_PATH)
  if (/^https?:\/\//i.test(aud)) { const v = items.find((i) => i.type === 'video'); if (v) v.audio = { url: aud, format: audioFormat(aud), size: 0 }; }
  if (!items.length) throw new ApiError(404, 'NOT_FOUND', 'The API did not return any media for this link');
  return { title: shortTitle(title), items };
}

module.exports = { callApi, fillTemplate };
