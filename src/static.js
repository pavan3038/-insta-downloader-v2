'use strict';
/* Static files from /public (+ header/footer partials, SITE_URL substitution, gzip, ETag). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { ROOT } = require('./config');
const { SEC_HEADERS, baseUrl, clientIp } = require('./http');
const stats = require('./stats');

const PUBLIC = path.join(ROOT, 'public');
const PARTIALS = path.join(ROOT, 'partials');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const PAGES = { '/': 'index.html', '/about': 'about.html', '/contact': 'contact.html', '/privacy': 'privacy.html', '/terms': 'terms.html' };
// pages that exist but must not be indexed / listed in the sitemap
const PRIVATE_PAGES = { '/admin': 'admin.html', '/offline': 'offline.html' };
const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow' };
const cache = new Map();

function load(file, base) {
  const st = fs.statSync(file);
  const key = file + '|' + base;
  const hit = cache.get(key);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  let buf = fs.readFileSync(file);
  const ext = path.extname(file);
  if (ext === '.html') {
    const part = (n) => fs.readFileSync(path.join(PARTIALS, n), 'utf8');
    buf = Buffer.from(buf.toString('utf8').replace('<!--@header-->', part('header.html')).replace('<!--@footer-->', part('footer.html')).replace(/__SITE_URL__/g, base));
  }
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = /^(text\/|image\/svg)/.test(type);
  const entry = { mtime: st.mtimeMs, buf, type, gz: compressible && buf.length > 512 ? zlib.gzipSync(buf, { level: 9 }) : null,
    etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"' };
  cache.set(key, entry);
  return entry;
}

function send(req, res, file, base, status = 200, extra = {}) {
  let f;
  try { f = load(file, base); } catch { return false; }
  const noCache = f.type.startsWith('text/html') || file.endsWith('sw.js') || file.endsWith('.webmanifest');
  const h = { ...SEC_HEADERS, 'Content-Type': f.type, ETag: f.etag, Vary: 'Accept-Encoding',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=86400', ...extra };
  if (status === 200 && req.headers['if-none-match'] === f.etag) { res.writeHead(304, h); res.end(); return true; }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? f.gz : f.buf;
  if (gz) h['Content-Encoding'] = 'gzip';
  h['Content-Length'] = body.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function notFound(req, res, base) {
  if (!send(req, res, path.join(PUBLIC, '404.html'), base, 404, NOINDEX)) { res.writeHead(404); res.end('Not found'); }
}

function serve(req, res, pathname) {
  const base = baseUrl(req);
  if (pathname === '/robots.txt') {
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /offline\n\nSitemap: ${base}/sitemap.xml\n`);
  }
  if (pathname === '/sitemap.xml') {
    const urls = Object.keys(PAGES).map((p) => `<url><loc>${base}${p}</loc></url>`).join('');
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }
  const clean = pathname.replace(/\.html$/, '').replace(/(.)\/$/, '$1');
  if (PAGES[clean]) {
    if (req.method === 'GET') stats.pageView(clientIp(req), req.headers['user-agent']);
    return send(req, res, path.join(PUBLIC, PAGES[clean]), base) || notFound(req, res, base);
  }
  if (PRIVATE_PAGES[clean]) return send(req, res, path.join(PUBLIC, PRIVATE_PAGES[clean]), base, 200, { ...NOINDEX, 'Cache-Control': 'no-store' }) || notFound(req, res, base);
  if (pathname === '/favicon.ico') return send(req, res, path.join(PUBLIC, 'img', 'favicon.svg'), base) || notFound(req, res, base);

  // other static assets (style.css, js/*, img/*, ads.txt) – never HTML pages, never dotfiles
  const file = path.normalize(path.join(PUBLIC, pathname));
  const ext = path.extname(file);
  if (file.startsWith(PUBLIC + path.sep) && ext && ext !== '.html' && MIME[ext] && !file.split(path.sep).some((p) => p.startsWith('.')) &&
      fs.existsSync(file) && fs.statSync(file).isFile()) return send(req, res, file, base);
  notFound(req, res, base);
}

module.exports = { serve, PAGES, PRIVATE_PAGES };
