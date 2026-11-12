/* Admin dashboard. Shows only real counters returned by the server; every value is inserted with textContent. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var csrf = null, timer = null, NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { n.textContent = ''; return n; }
  function api(path, opt) {
    opt = opt || {};
    var h = { 'Content-Type': 'application/json' }; if (opt.method === 'POST' && csrf) h['X-CSRF-Token'] = csrf;
    return fetch('/admin/api/' + path, { method: opt.method || 'GET', headers: h, credentials: 'same-origin', body: opt.body ? JSON.stringify(opt.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Error'); e.status = r.status; e.code = j.code; throw e; } return j; }); });
  }
  var num = function (n) { return n == null ? '—' : Number(n).toLocaleString(); };
  function when(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleString(); }
  function uptime(s) { var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'm'; }

  function show(which) { ['a-login', 'a-off', 'a-dash'].forEach(function (id) { $(id).hidden = id !== which; }); var on = which === 'a-dash'; $('a-logout').hidden = !on; $('a-refresh').hidden = !on; }

  function bars(host, obj) {
    clear(host);
    var keys = Object.keys(obj || {}).sort(function (a, b) { return obj[b] - obj[a]; });
    if (!keys.length) { host.appendChild(el('p', 'muted small', 'No data yet.')); return; }
    var max = obj[keys[0]], wrap = el('div', 'adm-bars');
    keys.forEach(function (k) {
      var row = el('div', 'adm-bar-row'); row.appendChild(el('span', null, k));
      var t = el('div', 't'), f = el('div'); f.style.width = Math.max(3, obj[k] * 100 / max) + '%'; t.appendChild(f); row.appendChild(t); row.appendChild(el('b', null, num(obj[k]))); wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }
  function table(host, head, rows, empty) {
    clear(host);
    if (!rows.length) { host.appendChild(el('p', 'muted small', empty)); return; }
    var t = el('table', 'adm-table'), tr = el('tr'); head.forEach(function (h) { tr.appendChild(el('th', null, h)); }); t.appendChild(tr);
    rows.forEach(function (r) { var x = el('tr'); r.forEach(function (c) { x.appendChild(el('td', null, c == null ? '' : String(c))); }); t.appendChild(x); });
    host.appendChild(t);
  }
  function svg(tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }

  function chart(host, days) {
    clear(host);
    if (!days.length) { host.appendChild(el('p', 'muted small', 'No data yet.')); return; }
    var W = 560, H = 190, L = 34, B = 22, T = 8, R = 6, pw = W - L - R, ph = H - T - B;
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.requests; })));
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Requests and failures per day' });
    [0, .5, 1].forEach(function (f) { var y = T + ph - ph * f; s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, 'class': 'grid' })); var t = svg('text', { x: L - 4, y: y + 3, 'text-anchor': 'end' }); t.textContent = Math.round(max * f); s.appendChild(t); });
    var bw = pw / days.length;
    days.forEach(function (d, i) {
      var x = L + i * bw + bw * .15, w = bw * .7, h = ph * d.requests / max, fh = ph * d.failed / max;
      var r = svg('rect', { x: x, y: T + ph - h, width: w, height: h, rx: 3, fill: '#8b5cf6' }); var tt = svg('title'); tt.textContent = d.date + ': ' + d.requests + ' requests, ' + d.failed + ' failed, ' + d.pageViews + ' page views'; r.appendChild(tt); s.appendChild(r);
      if (fh) s.appendChild(svg('rect', { x: x, y: T + ph - fh, width: w, height: fh, rx: 3, fill: '#f87171' }));
      if (i % 2 === 0 || days.length < 8) { var l = svg('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle' }); l.textContent = d.date.slice(5); s.appendChild(l); }
    });
    var wrap = el('div', 'adm-chart'); wrap.appendChild(s); host.appendChild(wrap);
  }

  function render(o) {
    var t = o.totals, kp = clear($('a-kpis'));
    var today = o.days.length ? o.days[o.days.length - 1] : null;
    [['Page views', t.pageViews], ['Unique visitors today', today ? today.uniqueVisitors : 0], ['Requests', t.requests], ['Successful', t.success], ['Failed', t.failed],
     ['Success rate', o.successRate == null ? '—' : o.successRate + '%'], ['Downloads completed', t.downloadsCompleted], ['Feedback', t.feedback], ['Contact messages', o.contactMessages]]
      .forEach(function (k) { var d = el('div', 'kpi'); d.appendChild(el('b', null, typeof k[1] === 'number' ? num(k[1]) : k[1])); d.appendChild(el('span', null, k[0])); kp.appendChild(d); });
    chart($('a-chart'), o.days);
    var pv = clear($('a-prov')), wrap = el('div', 'adm-prov');
    o.providers.forEach(function (p) {
      var d = el('div'), top = el('div'); top.appendChild(el('b', null, p.name + ' '));
      var st = !p.configured ? ['not configured', ''] : p.consecutiveFailures >= 3 ? ['failing', 'err'] : p.fail && !p.ok ? ['failing', 'err'] : p.ok || p.fail ? ['ok', 'ok'] : ['configured', 'warn'];
      top.appendChild(el('span', 'pill ' + st[1], st[0])); d.appendChild(top);
      if (p.configured) d.appendChild(el('div', 'muted small', 'ok ' + p.ok + ' · fail ' + p.fail + (p.lastLatencyMs ? ' · last ' + p.lastLatencyMs + ' ms' : '') + (p.lastError ? ' · last error ' + p.lastError : '') + (p.lastOk ? ' · last ok ' + when(p.lastOk) : '')));
      wrap.appendChild(d);
    });
    pv.appendChild(wrap);
    bars($('a-mode'), o.byMode); bars($('a-type'), o.byMediaType); bars($('a-code'), o.byErrorCode);
    var f = o.feedback, fs = clear($('a-fb-sum'));
    fs.appendChild(el('p', null, f.ratingCount ? 'Average rating ' + f.averageRating + ' / 5 from ' + f.ratingCount + ' ratings' : 'No ratings yet.'));
    fs.appendChild(el('p', 'muted small', f.total + ' entries · ' + f.problems + ' problem reports'));
    table($('a-errs'), ['Time', 'Level', 'Message', 'Details'], o.errors.map(function (e) { var d = Object.assign({}, e); delete d.ts; delete d.level; delete d.msg; return [when(e.ts), e.level, e.msg, Object.keys(d).map(function (k) { return k + '=' + d[k]; }).join(' ')]; }), 'No errors recorded.');
    table($('a-fb'), ['Time', 'Type', 'Rating', 'Message', 'Email'], f.items.map(function (x) { return [when(x.ts || x.at), x.type, x.rating || '', x.message, x.email || '']; }), 'No feedback yet.');
    var sy = o.system, sh = clear($('a-sys'));
    [['Uptime', uptime(sy.uptimeSeconds)], ['Node', sy.node], ['Memory', sy.memoryMB + ' MB'], ['Storage', sy.storage ? sy.storage.mode + (sy.storage.persistent ? '' : ' (not persistent)') + (sy.storage.dir ? ' · ' + sy.storage.dir : '') : '—']].forEach(function (r) { sh.appendChild(el('p', null, r[0] + ': ' + r[1])); });
    $('a-since').textContent = when(o.since);
    $('a-upd').textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  function load() {
    return api('overview').then(render).catch(function (e) { if (e.status === 401) { stop(); show('a-login'); } });
  }
  function start() { show('a-dash'); load(); stop(); timer = setInterval(function () { if (!document.hidden) load(); }, 30000); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  $('a-form').addEventListener('submit', function (e) {
    e.preventDefault(); var err = $('a-err'), btn = $('a-go'); err.hidden = true; btn.disabled = true;
    api('login', { method: 'POST', body: { user: $('a-user').value, password: $('a-pass').value } })
      .then(function (j) { csrf = j.csrf; $('a-pass').value = ''; start(); })
      .catch(function (x) { err.textContent = x.status === 429 ? 'Too many failed attempts. Try again later.' : x.status === 401 ? 'Wrong username or password.' : 'Login failed.'; err.hidden = false; })
      .then(function () { btn.disabled = false; });
  });
  $('a-logout').addEventListener('click', function () { api('logout', { method: 'POST' }).catch(function () {}).then(function () { csrf = null; stop(); $('a-upd').textContent = ''; show('a-login'); }); });
  $('a-refresh').addEventListener('click', load);
  $('a-check').addEventListener('click', function () {
    var out = $('a-check-out'), b = $('a-check'); b.disabled = true; out.textContent = 'Checking…';
    api('health-check', { method: 'POST' }).then(function (j) {
      out.textContent = j.results.map(function (r) { return r.name + ': ' + r.state + (r.latencyMs ? ' (' + r.latencyMs + ' ms)' : '') + (r.code ? ' ' + r.code : ''); }).join(' · '); load();
    }).catch(function (e) { out.textContent = e.status === 429 ? 'Too many checks, wait a minute.' : 'Check failed.'; }).then(function () { b.disabled = false; });
  });

  api('status').then(function (s) {
    if (!s.configured) return show('a-off');
    if (s.loggedIn) { csrf = s.csrf; start(); } else show('a-login');
  }).catch(function () { show('a-login'); });
})();
