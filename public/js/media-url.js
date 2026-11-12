/* Instagram link parsing + which downloader tab accepts which link (mirrors src/utils.js on the server). */
(function () {
  'use strict';
  function parse(raw) {
    var s = (raw || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    var host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    if (host !== 'instagram.com' && host !== 'instagr.am') return null;
    var st = u.pathname.match(/^\/stories\/([A-Za-z0-9._]+)\/(\d{5,25})/);
    if (st) return { type: 'story', shortcode: st[2], canonical: 'https://www.instagram.com/stories/' + st[1] + '/' + st[2] + '/' };
    var m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,})/);
    if (!m) return null;
    var kind = m[1] === 'reels' ? 'reel' : m[1];
    return { type: kind === 'p' ? 'post' : kind === 'tv' ? 'igtv' : 'reel', shortcode: m[2], canonical: 'https://www.instagram.com/' + kind + '/' + m[2] + '/' };
  }
  /** Returns null when the link fits the tab, otherwise the i18n key explaining why not. */
  function tabError(mode, parsed) {
    if (mode === 'story' && parsed.type !== 'story') return 'err.storyOnly';
    if ((mode === 'video' || mode === 'photo') && parsed.type === 'story') return 'err.notStory';
    return null;
  }
  function bytes(n) {
    if (!n) return '';
    if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }
  function duration(sec) {
    if (!sec || !isFinite(sec)) return '';
    sec = Math.round(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  window.IG.media = { parse: parse, tabError: tabError, bytes: bytes, duration: duration };
})();
