'use strict';
/* Official Instagram API (Instagram Login): reels, photos, carousels and stories of the account that owns the token. */
const { cfg } = require('../config');
const { ApiError, jsonFetch, shortTitle } = require('../utils');

const q = encodeURIComponent;

async function findInList(startUrl, baseHost, maxPages, match) {
  let next = startUrl;
  for (let page = 0; page < maxPages && next; page++) {
    const data = await jsonFetch(next);
    const hit = (data.data || []).find(match);
    if (hit) return hit;
    const n = data.paging && data.paging.next;
    next = n && new URL(n).host === baseHost ? n : null; // never send the token to another host
  }
  return null;
}

const toItem = (m) => (m.media_url
  ? m.media_type === 'VIDEO'
    ? { type: 'video', url: m.media_url, thumb: m.thumbnail_url || '' }
    : m.media_type === 'IMAGE' ? { type: 'image', url: m.media_url, thumb: '' } : null
  : null);

module.exports = {
  name: 'graph',
  configured: () => !!cfg.graph.token,

  /** Cheap authenticated call used by the admin "health check". */
  async ping() {
    await jsonFetch(`${cfg.graph.base}/me?fields=id&access_token=${q(cfg.graph.token)}`, {}, 0);
  },

  async resolve(parsed) {
    const { token, base, maxPages } = cfg.graph;
    const baseHost = new URL(base).host;
    const fields = 'id,media_type,media_url,permalink,thumbnail_url,caption,timestamp';
    const isStory = parsed.type === 'story';
    const start = `${base}/me/${isStory ? 'stories' : 'media'}?fields=${fields}&limit=50&access_token=${q(token)}`;
    const match = isStory
      ? (m) => m.id === parsed.shortcode || (m.permalink || '').includes('/' + parsed.shortcode)
      : (m) => (m.permalink || '').includes('/' + parsed.shortcode + '/');

    const m = await findInList(start, baseHost, isStory ? 1 : maxPages, match);
    if (!m) throw new ApiError(404, 'NOT_OWNED', 'Media is not in the connected account');

    let items = [];
    if (m.media_type === 'CAROUSEL_ALBUM') {
      const kids = await jsonFetch(`${base}/${q(m.id)}/children?fields=id,media_type,media_url,thumbnail_url&access_token=${q(token)}`);
      items = (kids.data || []).map(toItem).filter(Boolean);
    } else {
      const it = toItem(m); if (it) items = [it];
    }
    if (!items.length) throw new ApiError(404, 'NOT_FOUND', 'This item has no downloadable media');
    return { title: shortTitle(m.caption), items };
  },
};
