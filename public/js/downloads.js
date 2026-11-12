/* Download manager: sequential queue, real progress (only when the size is known), cancel, retry, duplicate prevention. */
(function () {
  'use strict';
  var IG = window.IG, t = IG.t;
  var panel = document.getElementById('dm'), listEl = document.getElementById('dm-list'), clearBtn = document.getElementById('dm-clear');
  if (!panel) return;

  var tasks = [];            // newest first
  var running = null;
  var seq = 0;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(navigator.userAgent);
  var canShareFiles = !!(navigator.canShare && navigator.share);          // checked again per file at click time

  var api = { onDone: null };

  /* ---------- public ---------- */
  /** spec: { key, label, url, meta }.  Returns false when an identical download is already queued/running. */
  api.add = function (spec) {
    var dup = tasks.some(function (x) { return x.key === spec.key && (x.status === 'queued' || x.status === 'downloading'); });
    if (dup) { IG.toast(t('dm.dup')); return false; }
    // a finished/failed/cancelled entry of the same file is replaced by the new attempt
    tasks = tasks.filter(function (x) { return x.key !== spec.key; });
    tasks.unshift({ id: ++seq, key: spec.key, label: spec.label, url: spec.url, meta: spec.meta || {}, status: 'queued', loaded: 0, total: 0, filename: '', file: null, ctl: null, errKey: '', retrying: false });
    render(); pump();
    return true;
  };
  api.clearFinished = function () {
    tasks = tasks.filter(function (x) { return x.status === 'queued' || x.status === 'downloading'; });
    render();
  };

  /* ---------- queue ---------- */
  function pump() {
    if (running) return;
    var next = null;
    for (var i = tasks.length - 1; i >= 0; i--) if (tasks[i].status === 'queued') { next = tasks[i]; break; }   // oldest queued first
    if (!next) return;
    running = next;
    run(next).then(function () { running = null; pump(); });
  }

  function filenameFrom(res, fallback) {
    var cd = res.headers.get('content-disposition') || '', m = cd.match(/filename="([^"]+)"/);
    return m ? m[1] : fallback;
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; a.rel = 'noopener'; a.className = 'offscreen';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
  }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function attempt(task) {
    task.ctl = new AbortController();
    return fetch(task.url, { signal: task.ctl.signal }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) { var e = new Error('http'); e.code = j.code || 'UPSTREAM'; throw e; });
      }
      task.total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
      task.filename = filenameFrom(res, 'instagram-media');
      var type = res.headers.get('content-type') || 'application/octet-stream';
      if (!res.body || !res.body.getReader) return res.blob();
      var reader = res.body.getReader(), chunks = [];
      task.loaded = 0;
      function pull() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks, { type: type });
          chunks.push(r.value); task.loaded += r.value.length; paint(task);
          return pull();
        });
      }
      return pull();
    }).then(function (blob) {
      if (task.total && blob.size < task.total) { var e = new Error('incomplete'); e.code = 'INCOMPLETE'; throw e; }
      return blob;
    });
  }

  function run(task) {
    task.status = 'downloading'; task.loaded = 0; task.total = 0; task.errKey = ''; task.retrying = false; task.cancelRequested = false;
    render();
    var tries = 0;
    function go() {
      tries++;
      return attempt(task).then(function (blob) {
        task.status = 'done'; task.ctl = null; task.retrying = false;
        try { task.file = new File([blob], task.filename, { type: blob.type }); } catch (e) { task.file = null; }
        saveBlob(blob, task.filename);
        render();
        IG.toast(t('toast.done'), 'ok');
        if (typeof api.onDone === 'function') api.onDone(task);
      }).catch(function (e) {
        if (e && e.name === 'AbortError') { task.status = 'cancelled'; task.ctl = null; render(); return; }
        var networkLike = !(e && e.code && e.code !== 'INCOMPLETE');                    // fetch/stream failures have no API code
        if (networkLike && tries < 2) { task.retrying = true; render(); return wait(1200).then(function () { if (task.cancelRequested) { task.status = 'cancelled'; task.retrying = false; render(); return null; } return go(); }); }
        task.status = 'failed'; task.ctl = null; task.retrying = false;
        task.errKey = e && e.code && e.code !== 'INCOMPLETE' ? 'err.' + e.code : e && e.code === 'INCOMPLETE' ? 'err.incomplete' : 'err.network';
        if (!IG.t(task.errKey) || IG.t(task.errKey) === task.errKey) task.errKey = 'err.generic';
        render();
        IG.toast(t(task.errKey), 'err', 5000);
      });
    }
    return go();
  }

  /* ---------- UI ---------- */
  function find(id) { for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i]; return null; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function progressText(task) {
    if (task.retrying) return t('dm.retrying');
    if (task.total) return Math.round(task.loaded * 100 / task.total) + '% · ' + IG.media.bytes(task.loaded) + ' / ' + IG.media.bytes(task.total);
    return IG.media.bytes(task.loaded || 1) + ' · ' + t('dm.progressUnknown');
  }
  /** lightweight update during streaming (no full re-render) */
  function paint(task) {
    var row = listEl.querySelector('[data-id="' + task.id + '"]'); if (!row) return;
    var bar = row.querySelector('.track'), fill = row.querySelector('.track > div'), txt = row.querySelector('.dm-sub');
    if (task.total) { bar.classList.remove('indet'); var pct = Math.min(100, task.loaded * 100 / task.total); fill.style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(Math.round(pct))); }
    else { bar.classList.add('indet'); bar.removeAttribute('aria-valuenow'); }
    txt.textContent = progressText(task);
  }
  function doneNote() { return isIOS ? t('dm.done.ios') : isAndroid ? t('dm.done.android') : t('dm.done.pc'); }

  function render() {
    panel.hidden = tasks.length === 0;
    listEl.textContent = '';
    tasks.forEach(function (task) {
      var li = el('li', 'dm-row ' + task.status); li.setAttribute('data-id', String(task.id));
      var top = el('div', 'dm-top');
      top.appendChild(el('span', 'dm-name', task.label));
      top.appendChild(el('span', 'status ' + task.status, t('dm.' + task.status)));
      li.appendChild(top);

      if (task.status === 'downloading') {
        var tr = el('div', 'track' + (task.total ? '' : ' indet')); tr.setAttribute('role', 'progressbar'); tr.setAttribute('aria-valuemin', '0'); tr.setAttribute('aria-valuemax', '100'); tr.setAttribute('aria-label', task.label);
        var f = el('div'); f.style.width = task.total ? Math.min(100, task.loaded * 100 / task.total) + '%' : '0'; tr.appendChild(f);
        if (task.total) tr.setAttribute('aria-valuenow', String(Math.round(task.loaded * 100 / task.total)));
        li.appendChild(tr); li.appendChild(el('div', 'dm-sub', progressText(task)));
      } else if (task.status === 'done') {
        li.appendChild(el('div', 'dm-sub', task.filename + ' · ' + IG.media.bytes(task.file ? task.file.size : 0) + ' — ' + doneNote()));
      } else if (task.status === 'failed') {
        li.appendChild(el('div', 'dm-sub err', t(task.errKey)));
      }

      var act = el('div', 'dm-act');
      if (task.status === 'queued' || task.status === 'downloading') {
        var c = el('button', 'icon-btn sm', t('btn.cancel')); c.type = 'button';
        c.addEventListener('click', function () { var x = find(task.id); if (!x) return; x.cancelRequested = true; if (x.status === 'downloading' && x.ctl) x.ctl.abort(); else { x.status = 'cancelled'; render(); } });
        act.appendChild(c);
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        var r = el('button', 'icon-btn sm primary', t('btn.retry')); r.type = 'button';
        r.addEventListener('click', function () { var x = find(task.id); if (!x) return; x.status = 'queued'; render(); pump(); });
        act.appendChild(r);
      }
      if (task.status === 'done' && task.file && canShareFiles && (function () { try { return navigator.canShare({ files: [task.file] }); } catch (e) { return false; } })()) {
        var s = el('button', 'icon-btn sm', t(isIOS ? 'btn.save' : 'btn.share')); s.type = 'button';
        s.addEventListener('click', function () {
          var f = task.file; try { if (navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(function () {}); } catch (e) {}
        });
        act.appendChild(s);
      }
      if (task.status !== 'downloading') {
        var d = el('button', 'icon-btn sm', t('btn.remove')); d.type = 'button';
        d.addEventListener('click', function () { tasks = tasks.filter(function (x) { return x.id !== task.id; }); render(); });
        act.appendChild(d);
      }
      li.appendChild(act);
      listEl.appendChild(li);
    });
  }

  clearBtn.addEventListener('click', api.clearFinished);
  IG.onLang(render);
  IG.downloads = api;
})();
