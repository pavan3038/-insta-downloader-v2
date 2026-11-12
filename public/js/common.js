/* Shared on every page: translations, theme + language toggles, mobile menu, toasts, back-to-top, PWA. */
(function () {
  'use strict';
  var D = window.IG_DICT || { hi: {}, en: {} };
  var root = document.documentElement;
  var listeners = [];

  function lang() { return root.getAttribute('lang') === 'en' ? 'en' : 'hi'; }
  function t(key, vars) {
    var s = (D[lang()] && D[lang()][key]) || (D.en && D.en[key]) || key;
    s = s.replace('{year}', String(new Date().getFullYear()));
    if (vars) for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function apply() {
    var n, i;
    n = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < n.length; i++) n[i].textContent = t(n[i].getAttribute('data-i18n'));
    n = document.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < n.length; i++) n[i].setAttribute('placeholder', t(n[i].getAttribute('data-i18n-placeholder')));
    n = document.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < n.length; i++) n[i].setAttribute('aria-label', t(n[i].getAttribute('data-i18n-aria')));
    var page = document.body.getAttribute('data-page');
    if (page) document.title = t('meta.' + page);
    var lt = document.getElementById('lang-toggle');
    if (lt) lt.textContent = lang() === 'hi' ? 'EN' : 'हिंदी';
    for (i = 0; i < listeners.length; i++) listeners[i](lang());
  }
  function setLang(l) { root.setAttribute('lang', l); store('insta_lang', l); apply(); }
  function setTheme(th) {
    root.setAttribute('data-theme', th); store('insta_theme', th);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', th === 'dark' ? '#0b0818' : '#6d28d9');
  }

  function toast(msg, type, ms) {
    var box = document.getElementById('toasts'); if (!box) return;
    var el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.textContent = msg;
    box.appendChild(el); setTimeout(function () { el.remove(); }, ms || 3200);
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.className = 'offscreen'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove(); toast(ok ? t('toast.copied') : t('toast.copyFail'), ok ? 'ok' : 'err');
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(t('toast.copied'), 'ok'); }, fallback);
    else fallback();
  }

  window.IG = { t: t, lang: lang, toast: toast, copyText: copyText, onLang: function (cb) { listeners.push(cb); } };

  document.addEventListener('DOMContentLoaded', function () {
    var lt = document.getElementById('lang-toggle'), tt = document.getElementById('theme-toggle');
    if (lt) lt.addEventListener('click', function () { setLang(lang() === 'hi' ? 'en' : 'hi'); });
    if (tt) tt.addEventListener('click', function () { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });
    setTheme(root.getAttribute('data-theme') || 'dark');

    /* mobile navigation */
    var menuBtn = document.getElementById('menu-toggle'), nav = document.getElementById('site-nav');
    function closeMenu() { if (nav) { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } }
    if (menuBtn && nav) {
      menuBtn.addEventListener('click', function () {
        var open = nav.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') closeMenu(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    }

    /* back-to-top */
    var top = document.getElementById('to-top');
    if (top) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return; ticking = true;
        requestAnimationFrame(function () { top.classList.toggle('show', window.scrollY > 700); ticking = false; });
      }, { passive: true });
      top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }

    apply();

    /* online / offline feedback */
    window.addEventListener('offline', function () { toast(t('toast.offline'), 'err', 4000); });
    window.addEventListener('online', function () { toast(t('toast.online'), 'ok'); });

    /* PWA: service worker + install prompt (only offered where the browser supports it) */
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
    var installBtn = document.getElementById('install-btn'), deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; if (installBtn) installBtn.hidden = false; });
    if (installBtn) installBtn.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; installBtn.hidden = true; });
    });
    window.addEventListener('appinstalled', function () { if (installBtn) installBtn.hidden = true; toast(t('toast.installed'), 'ok'); });
  });
})();
