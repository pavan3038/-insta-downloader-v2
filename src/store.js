'use strict';
/* Short-lived (15 min) in-memory map of resolved media. Video files are never stored. */
const crypto = require('crypto');

const store = new Map();
const TTL = 15 * 60 * 1000;

function putEntry(e) {
  if (store.size >= 500) store.delete(store.keys().next().value);
  const id = crypto.randomBytes(12).toString('base64url');
  store.set(id, { ...e, expires: Date.now() + TTL });
  return id;
}
function getEntry(id) {
  const e = store.get(id);
  if (!e) return null;
  if (e.expires < Date.now()) { store.delete(id); return null; }
  return e;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of store) if (v.expires < n) store.delete(k); }, 60000).unref();

module.exports = { putEntry, getEntry };
