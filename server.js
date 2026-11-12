'use strict';
/**
 * Insta Downloader – entry point (zero dependencies, Node 18+).
 *
 *   src/config.js          env / .env handling (auto-reloads when .env changes)
 *   src/utils.js           URL parsing, SSRF guard, safe fetch, response auto-detection
 *   src/providers/*        graph (official), rapidapi, custom – only active when keys are set
 *   src/api.js             /api/* handlers      src/static.js  pages + assets
 *   public/                index.html, style.css, js/, img/    partials/  shared header & footer
 */
const http = require('http');
const { cfg } = require('./src/config');
const { ApiError } = require('./src/utils');
const { sendJson } = require('./src/http');
const { activeProviders } = require('./src/providers');
const api = require('./src/api');
const admin = require('./src/admin');
const feedback = require('./src/feedback');
const log = require('./src/log');
const stats = require('./src/stats');
const staticFiles = require('./src/static');

const server = http.createServer(async (req, res) => {
  try {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
    const get = req.method === 'GET' || req.method === 'HEAD';

    if (pathname === '/api/status' && get) return api.status(req, res);
    if (pathname === '/api/health' && get) return api.health(req, res);
    if (pathname === '/api/feedback' && req.method === 'POST') return await feedback.submit(req, res);
    if (pathname.startsWith('/admin/api/')) return await admin.handle(req, res, pathname.slice('/admin/api/'.length));
    if (pathname === '/api/resolve' && req.method === 'POST') return await api.resolve(req, res);
    if (pathname === '/api/contact' && req.method === 'POST') return await api.contact(req, res);
    const m = pathname.match(/^\/api\/(download|stream|thumb)\/([A-Za-z0-9_-]{8,40})(?:\/(\d{1,2}))?$/);
    if (m && get) {
      const sp = new URL(req.url, 'http://x').searchParams, q = sp.get('q');
      return await api.media(req, res, m[2], m[1], m[3] == null ? 0 : Number(m[3]), q != null && /^\d{1,2}$/.test(q) ? Number(q) : null, sp.get('a') === '1');
    }
    if (pathname.startsWith('/api/')) throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint');
    if (!get) { res.writeHead(405, { Allow: 'GET, HEAD, POST' }); return res.end(); }
    staticFiles.serve(req, res, pathname);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e instanceof ApiError) return sendJson(res, e.status, { error: e.message, code: e.code });
    log.error('unhandled error', { message: e && e.message });
    sendJson(res, 500, { error: 'Internal server error', code: 'INTERNAL' });
  }
});
server.requestTimeout = 0; // allow long video streams
server.headersTimeout = 30000;
server.keepAliveTimeout = 65000;

function shutdown() { stats.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  server.listen(cfg.port, cfg.host, () => {
    const ps = activeProviders().map((p) => p.name);
    console.log(`Insta Downloader running on http://localhost:${cfg.port}`);
    console.log(ps.length ? `Active providers: ${ps.join(', ')}` : 'WARNING: no API key configured – the site will show "API not configured". See .env.example');
    const st = require('./src/storage').info();
    console.log(`Storage: ${st.mode}${st.dir ? ' (' + st.dir + ')' : ''}${st.persistent ? '' : ' – NOT persistent, data is lost on restart'}${st.note ? ' – ' + st.note : ''}`);
    console.log(admin.configured() ? 'Admin dashboard: enabled at /admin' : 'Admin dashboard: disabled (set ADMIN_USER and ADMIN_PASSWORD_HASH to enable)');
  });
}
module.exports = { server };
