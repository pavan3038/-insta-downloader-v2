'use strict';
const { cfg, reload } = require('../config');
const graph = require('./graph');
const rapidapi = require('./rapidapi');
const custom = require('./custom');

/** Providers that are currently configured, in priority order (official API first). */
function activeProviders() {
  reload(); // picks up .env edits without a restart
  const on = [graph, rapidapi, custom].filter((p) => p.configured());
  return cfg.provider === 'auto' ? on : on.filter((p) => p.name === cfg.provider);
}

const all = [graph, rapidapi, custom];
module.exports = { activeProviders, all };
