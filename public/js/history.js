/* Privacy-friendly download history: link, type and date only, in this browser's localStorage. */
(function () {
  'use strict';
  var IG = window.IG, t = IG.t;
  var KEY = 'insta_dl_history_v2', MAX = 30;
  var list = document.getElementById('hist-list'), empty = document.getElementById('hist-empty'), clearBtn = document.getElementById('clear-hist');
  if (!list) return;

  function load() { try { var a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(0, MAX))); } catch (e) {} }

  function add(e) {
    var a = load().filter(function (x) { return x.shortcode !== e.shortcode; });
    a.unshift({ shortcode: e.shortcode, url: e.url, type: e.type, kind: e.kind, count: e.count, ts: Date.now() });
    save(a); render();
  }
  function fmt(ts) {
    try { return new Date(ts).toLocaleString(IG.lang() === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return new Date(ts).toLocaleString(); }
  }
  function btn(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn sm'; b.textContent = label; b.addEventListener('click', fn); return b; }
  var ICON = { video: '🎬', photo: '📷', carousel: '🖼️' };

  function render() {
    var a = load();
    list.textContent = '';
    empty.hidden = a.length > 0; clearBtn.hidden = a.length === 0;
    a.forEach(function (h) {
      var li = document.createElement('li'); li.className = 'card';
      var ic = document.createElement('span'); ic.className = 'h-ic'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = h.type === 'story' ? '⭕' : (ICON[h.kind] || '⚡');
      var main = document.createElement('div'); main.className = 'h-main';
      var tt = document.createElement('div'); tt.className = 'h-title';
      tt.textContent = t('type.' + h.type) + ' · ' + t('kind.' + (h.kind || 'video')) + (h.count > 1 ? ' · ' + t('hist.count', { n: h.count }) : '');
      var sub = document.createElement('div'); sub.className = 'h-sub'; sub.textContent = fmt(h.ts);
      main.appendChild(tt); main.appendChild(sub);
      var act = document.createElement('div'); act.className = 'h-act';
      act.appendChild(btn(t('btn.again'), function () {
        var input = document.getElementById('url'); input.value = h.url; input.dispatchEvent(new Event('input'));
        document.getElementById('downloader').scrollIntoView({ behavior: 'smooth' });
        document.getElementById('dl-form').requestSubmit();
      }));
      act.appendChild(btn(t('btn.copyShort'), function () { IG.copyText(h.url); }));
      act.appendChild(btn(t('btn.remove'), function () { save(load().filter(function (x) { return x.shortcode !== h.shortcode; })); render(); IG.toast(t('toast.removed')); }));
      li.appendChild(ic); li.appendChild(main); li.appendChild(act); list.appendChild(li);
    });
  }
  clearBtn.addEventListener('click', function () {
    if (!window.confirm(t('hist.confirm'))) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    render(); IG.toast(t('toast.cleared'), 'ok');
  });
  IG.onLang(render);
  IG.history = { add: add, render: render };
  render();
})();
