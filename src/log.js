'use strict';
/* Minimal structured logger (JSON lines). Warnings/errors are also kept in the stats error log for the
 * admin dashboard. Never pass URLs, tokens, IPs or user content here. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = () => LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || 20;

function log(level, msg, fields) {
  if (level === 'warn' || level === 'error') {
    try { require('./stats').pushError({ level, msg, ...fields }); } catch { /* stats not ready */ }
  }
  if (LEVELS[level] < min()) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}
module.exports = {
  debug: (m, f) => log('debug', m, f), info: (m, f) => log('info', m, f),
  warn: (m, f) => log('warn', m, f), error: (m, f) => log('error', m, f),
};
