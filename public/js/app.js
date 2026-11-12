/* Home page: downloader tabs, smart URL input, resolve + preview gallery. */
(function () {
  'use strict';
  var IG = window.IG, t = IG.t, M = IG.media;
  var $ = function (id) { return document.getElementById(id); };

  var form = $('dl-form'), input = $('url'), goBtn = $('go-btn'), pasteBtn = $('paste-btn'), clearBtn = $('clear-btn'), inputWrap = input.parentNode;
  var hint = $('tab-hint'), panel = $('dl-panel'), tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var errBox = $('error-box'), errTitle = $('error-title'), errText = $('error-text'), errRetry = $('error-retry');
  var apiNotice = $('api-notice'), storyNote = $('story-note'), skeleton = $('skeleton'), result = $('result'), gallery = $('gallery');
  var rTitle = $('r-title'), rType = $('r-type'), rKind = $('r-kind'), rCount = $('r-count'), dlAll = $('dl-all'), copyBtn = $('copy-btn'), newBtn = $('new-btn');

  var mode = 'all';
  var fetching = false;
  var current = null;          // { data, parsed, mode, at }
  var lastErr = null;          // { code, key } – kept so the message can be re-translated

  var GO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 20h16"/></svg>';

  /* ---------- tabs ---------- */
  function setMode(m, focus) {
    mode = m;
    tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-mode') === m;
      tab.setAttribute('aria-selected', on ? 'true' : 'false'); tab.tabIndex = on ? 0 : -1;
      if (on) { panel.setAttribute('aria-labelledby', tab.id); if (focus) tab.focus(); tab.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    });
    input.setAttribute('data-i18n-placeholder', 'ph.' + m); input.setAttribute('placeholder', t('ph.' + m));
    hint.setAttribute('data-i18n', 'tab.hint.' + m); hint.textContent = t('tab.hint.' + m);
    storyNote.hidden = m !== 'story';
    clearError();
    try { localStorage.setItem('insta_tab', m); } catch (e) {}
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { setMode(tab.getAttribute('data-mode')); });
    tab.addEventListener('keydown', function (e) {
      var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (n == null) return;
      e.preventDefault(); setMode(tabs[(n + tabs.length) % tabs.length].getAttribute('data-mode'), true);
    });
  });

  /* ---------- errors ---------- */
  function showError(code, key, toast) {
    lastErr = { code: code, key: key }; renderError();
    skeleton.hidden = true;
    if (toast !== false) IG.toast(t(key), 'err', 5000);
  }
  function renderError() {
    if (!lastErr) return;
    errTitle.textContent = t('err.title'); errText.textContent = t(lastErr.key); errBox.hidden = false;
    var bad = lastErr.code === 'INVALID_URL' || lastErr.code === 'EMPTY' || lastErr.code === 'WRONG_TAB';
    input.setAttribute('aria-invalid', bad ? 'true' : 'false'); inputWrap.classList.toggle('invalid', bad);
  }
  function clearError() { lastErr = null; errBox.hidden = true; input.removeAttribute('aria-invalid'); inputWrap.classList.remove('invalid'); }
  function codeKey(code) {
    var known = ['INVALID_URL', 'NO_PROVIDER', 'NOT_OWNED', 'NOT_FOUND', 'NOT_AUTHORIZED', 'TOKEN_INVALID', 'CONFIG', 'UPSTREAM', 'RATE_LIMIT', 'EXPIRED'];
    return known.indexOf(code) >= 0 ? 'err.' + code : 'err.generic';
  }
  errRetry.addEventListener('click', function () { clearError(); if (input.value.trim()) form.requestSubmit(); else input.focus(); });

  /* ---------- API status banner (hides itself once a key is configured) ---------- */
  function checkStatus() {
    fetch('/api/status', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (s) { apiNotice.hidden = !!s.configured; }).catch(function () {});
  }
  checkStatus();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkStatus(); });

  /* ---------- input buttons ---------- */
  function syncInputButtons() { var has = input.value.length > 0; clearBtn.hidden = !has; pasteBtn.hidden = has; }
  function resetResult() { current = null; result.hidden = true; skeleton.hidden = true; gallery.textContent = ''; }
  function clearInput() { input.value = ''; resetResult(); clearError(); syncInputButtons(); input.focus(); }
  clearBtn.addEventListener('click', clearInput);
  pasteBtn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (txt) { input.value = (txt || '').trim(); syncInputButtons(); clearError(); input.focus(); },
        function () { IG.toast(t('toast.pasteFail'), 'err'); input.focus(); });
    } else { IG.toast(t('toast.pasteHint'), 'err', 5000); input.focus(); input.select(); }   // no Clipboard API (e.g. Firefox, older iOS): guide the user
  });
  input.addEventListener('paste', function () { setTimeout(function () { input.value = input.value.trim(); syncInputButtons(); clearError(); }, 0); });
  input.addEventListener('input', function () { syncInputButtons(); if (lastErr) clearError(); });

  function setBusy(b) {
    fetching = b;
    goBtn.disabled = b; input.readOnly = b; clearBtn.disabled = b; goBtn.setAttribute('aria-busy', b ? 'true' : 'false');
    goBtn.textContent = '';
    if (b) {
      var sp = document.createElement('span'); sp.className = 'spin'; goBtn.appendChild(sp);
      var l = document.createElement('span'); l.textContent = t('form.fetching'); goBtn.appendChild(l);
    } else { goBtn.innerHTML = GO_ICON + '<span></span>'; goBtn.lastChild.textContent = t('form.submit'); }
  }

  /* ---------- submit ---------- */
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (fetching) return;                                  // duplicate-request prevention
    clearError();
    var raw = input.value.trim();
    if (!raw) { showError('EMPTY', 'err.empty'); input.focus(); return; }
    var parsed = M.parse(raw);
    if (!parsed) { showError('INVALID_URL', 'err.invalid'); input.focus(); return; }
    var tabErr = M.tabError(mode, parsed);
    if (tabErr) { showError('WRONG_TAB', tabErr); return; }

    // same link + same tab already on screen (and not stale): do not hit the API again
    if (current && current.parsed.canonical === parsed.canonical && current.mode === mode && Date.now() - current.at < 10 * 60000) {
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return;
    }
    resetResult(); setBusy(true); skeleton.hidden = false;
    fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: parsed.canonical, mode: mode }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        setBusy(false); skeleton.hidden = true;
        if (!r.ok) { showError(r.j.code, codeKey(r.j.code)); if (r.j.code === 'NO_PROVIDER') checkStatus(); return; }
        var shown = filterItems(r.j.items);
        if (!shown.length) { showError('WRONG_TAB', mode === 'video' ? 'err.noVideo' : 'err.noPhoto'); return; }
        current = { data: r.j, parsed: parsed, mode: mode, at: Date.now() };
        renderResult();
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
      .catch(function () { setBusy(false); skeleton.hidden = true; showError('NETWORK', 'err.network'); });
  });

  function filterItems(items) {
    return items.filter(function (it) { return mode === 'video' ? it.type === 'video' : mode === 'photo' ? it.type === 'image' : true; });
  }

  /* ---------- result + gallery ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function renderResult() {
    if (!current) return;
    var d = current.data, shown = filterItems(d.items);
    rTitle.textContent = d.title || t('result.untitled');
    rType.textContent = t('type.' + d.type);
    var kind = shown.length > 1 ? 'carousel' : shown[0].type === 'video' ? 'video' : 'photo';
    rKind.textContent = t('kind.' + kind);
    rCount.hidden = shown.length < 2; rCount.textContent = t('result.items', { n: shown.length });
    dlAll.hidden = shown.length < 2; dlAll.textContent = t('btn.downloadAll', { n: shown.length });
    gallery.textContent = '';
    gallery.className = 'gallery n' + Math.min(shown.length, 3);
    shown.forEach(function (it, n) { gallery.appendChild(card(d, it, n, shown.length)); });
    result.hidden = false;
  }

  function chip(parent, key, text) {
    if (!text) return;
    var c = parent.querySelector('[data-k="' + key + '"]');
    if (!c) { c = el('li'); c.setAttribute('data-k', key); parent.appendChild(c); }
    c.textContent = text;
  }

  function card(d, it, n, total) {
    var isVideo = it.type === 'video';
    var art = el('article', 'item');
    var box = el('div', 'thumb ' + (isVideo ? 'video' : 'image'));
    var meta = el('ul', 'meta');

    if (isVideo) {
      var v = document.createElement('video');
      v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.src = it.preview;
      if (it.thumbnail) v.poster = it.thumbnail;
      v.setAttribute('aria-label', t('item.video') + ' ' + (n + 1));
      v.addEventListener('loadedmetadata', function () {      // real values read from the actual file
        if (!it.duration && isFinite(v.duration)) chip(meta, 'dur', M.duration(v.duration));
        if (!it.width && v.videoWidth) chip(meta, 'res', v.videoWidth + '×' + v.videoHeight);
      });
      box.appendChild(v);
    } else {
      var img = document.createElement('img');
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = t('item.photo') + ' ' + (n + 1); img.src = it.preview;
      img.addEventListener('load', function () { if (!it.width && img.naturalWidth) chip(meta, 'res', img.naturalWidth + '×' + img.naturalHeight); });
      box.appendChild(img);
    }
    var idx = el('span', 'idx', (n + 1) + '/' + total); idx.hidden = total < 2; box.appendChild(idx);
    art.appendChild(box);

    chip(meta, 'type', isVideo ? (it.format ? it.format.toUpperCase() : t('item.video')) : t('item.photo'));
    if (!isVideo && it.format) chip(meta, 'fmt', it.format.toUpperCase());
    if (it.duration) chip(meta, 'dur', M.duration(it.duration));
    if (it.width && it.height) chip(meta, 'res', it.width + '×' + it.height);
    if (it.size) chip(meta, 'size', M.bytes(it.size));
    art.appendChild(meta);

    /* clean download buttons: one per quality (best first), then audio-only when the provider really supplied it */
    var list = el('div', 'dl-list');
    function dlBtn(primary, title, fmt, size, onClick) {
      var b = el('button', 'dl-btn' + (primary ? ' primary' : '')); b.type = 'button';
      b.insertAdjacentHTML('afterbegin', GO_ICON);
      b.appendChild(el('span', 'dl-t', title));
      var bd = el('span', 'dl-badges');
      if (fmt) bd.appendChild(el('span', 'badge', String(fmt).toUpperCase()));
      if (size) bd.appendChild(el('span', 'badge', M.bytes(size)));
      b.appendChild(bd); b.addEventListener('click', onClick); list.appendChild(b); return b;
    }
    var vars = isVideo && it.variants && it.variants.length > 1 ? it.variants : null;
    if (vars) {
      vars.forEach(function (vr, i) {
        var label = vr.label || (vr.height ? vr.height + 'p' : '#' + (i + 1));
        dlBtn(i === 0, label + (i === 0 ? ' · ' + t('item.best') : ''), it.format || 'mp4', vr.size, function () { enqueue(d, it, n, total, vr.q); });
      });
    } else {
      dlBtn(true, t(isVideo ? 'item.dlVideo' : 'item.dlPhoto'), it.format || (isVideo ? '' : ''), it.size, function () { enqueue(d, it, n, total, null); });
    }
    if (isVideo && it.audio) dlBtn(false, '🎵 ' + t('item.audioOnly'), it.audio.format, it.audio.size, function () { enqueue(d, it, n, total, null, true); });
    art.appendChild(list);
    return art;
  }

  function enqueue(d, it, n, total, variant, audio) {
    var label = t('type.' + d.type) + ' · ' + (audio ? t('item.audioOnly') : it.type === 'video' ? t('item.video') : t('item.photo')) + (total > 1 ? ' ' + (n + 1) + '/' + total : '');
    var url = audio ? it.audio.download : it.download + (variant != null ? '?q=' + variant : '');
    var ok = IG.downloads.add({ key: d.id + ':' + n + ':' + (audio ? 'a' : variant == null ? '' : variant), label: label, url: url,
      meta: { shortcode: d.shortcode, link: current ? current.parsed.canonical : '', type: d.type, kind: d.kind, count: filterItems(d.items).length } });
    if (ok) IG.toast(t('toast.queued'));
    return ok;
  }

  dlAll.addEventListener('click', function () {
    if (!current) return;
    var d = current.data, shown = filterItems(d.items);
    shown.forEach(function (it, n) { enqueue(d, it, n, shown.length, null); });
  });
  copyBtn.addEventListener('click', function () { if (current) IG.copyText(current.parsed.canonical); });
  /* Share: Web Share API (native sheet on phones / modern browsers), otherwise the link is copied */
  var shareBtn = $('share-btn');
  if (shareBtn) shareBtn.addEventListener('click', function () {
    if (!current) return;
    var data = { title: 'Insta Downloader', text: current.data.title || 'Instagram', url: current.parsed.canonical };
    if (navigator.share) { navigator.share(data).catch(function (e) { if (e && e.name !== 'AbortError') IG.copyText(data.url); }); }
    else IG.copyText(data.url);               // fallback: copy the link (shows the "Link copied" toast)
  });
  newBtn.addEventListener('click', function () { clearInput(); $('downloader').scrollIntoView({ behavior: 'smooth' }); });

  /* a finished download is recorded in the (local) history – link, type and date only */
  IG.downloads.onDone = function (task) {
    var m = task.meta || {};
    if (m.shortcode && m.link) IG.history.add({ shortcode: m.shortcode, url: m.link, type: m.type, kind: m.kind, count: m.count });
  };

  IG.onLang(function () { renderError(); if (current) renderResult(); });

  /* ---------- init ---------- */
  var saved = null; try { saved = localStorage.getItem('insta_tab'); } catch (e) {}
  var q = new URLSearchParams(location.search);
  var startMode = ['all', 'video', 'photo', 'story'].indexOf(q.get('tab') || saved) >= 0 ? (q.get('tab') || saved) : 'all';
  setMode(startMode);
  if (q.get('url')) input.value = q.get('url');
  syncInputButtons();
})();
