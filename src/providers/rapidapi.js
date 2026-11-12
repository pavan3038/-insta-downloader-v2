'use strict';
/* RapidAPI (or any RapidAPI-style) Instagram downloader. Enabled only when RAPIDAPI_KEY + RAPIDAPI_HOST are set. */
const { cfg } = require('../config');
const { ApiError } = require('../utils');
const { callApi } = require('./generic');

module.exports = {
  name: 'rapidapi',
  configured: () => !!(cfg.rapidapi.key && cfg.rapidapi.host),
  async resolve(parsed) {
    const c = cfg.rapidapi;
    const base = c.base || `https://${c.host}`;
    if (!/^https?:\/\//i.test(base)) throw new ApiError(500, 'CONFIG', 'RAPIDAPI_HOST is invalid');
    const endpoint = c.endpoint.startsWith('/') || c.endpoint.startsWith('?') ? c.endpoint : '/' + c.endpoint;
    return callApi({
      url: base + endpoint, method: c.method, body: c.body, video: c.video, thumb: c.thumb, title: c.title, audio: c.audio,
      headers: { 'x-rapidapi-key': c.key, 'x-rapidapi-host': c.host },
    }, parsed);
  },
};
