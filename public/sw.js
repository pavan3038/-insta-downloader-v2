/* Service worker: caches the app shell so the site opens (and shows an offline page) without a connection.
 * It NEVER caches /api/ or /admin – downloading always needs the network. */
const VERSION = 'insta-v2-2';
const SHELL = ['/', '/offline', '/style.css', '/js/i18n.js', '/js/common.js', '/js/media-url.js', '/js/history.js', '/js/downloads.js', '/js/app.js', '/js/feedback.js', '/js/boot.js', '/img/favicon.svg', '/img/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname === '/sw.js') return;   // always network

  if (req.mode === 'navigate') {                       // pages: network first, then cache, then the offline page
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); if (res.ok) caches.open(VERSION).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match('/offline'))));
    return;
  }
  e.respondWith(caches.match(req).then((cached) => {   // assets: cache first, refresh in the background
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => cached);
    return cached || net;
  }));
});
