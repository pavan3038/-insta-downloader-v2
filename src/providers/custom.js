'use strict';
/* Any other authorised HTTP API you configure yourself (CUSTOM_API_*). Nothing is bundled. */
const { cfg } = require('../config');
const { ApiError } = require('../utils');
const { callApi, fillTemplate } = require('./generic');

module.exports = {
  name: 'custom',
  configured: () => !!cfg.custom.url,
  async resolve(parsed) {
    const c = cfg.custom;
    let headers = {};
    try { if (c.headers) headers = JSON.parse(fillTemplate(c.headers, parsed, false)); }
    catch { throw new ApiError(500, 'CONFIG', 'CUSTOM_API_HEADERS is not valid JSON'); }
    return callApi({ url: c.url, method: c.method, body: c.body, headers, video: c.video, thumb: c.thumb, title: c.title, audio: c.audio }, parsed);
  },
};
