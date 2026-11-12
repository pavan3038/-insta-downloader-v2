/* Rating / feedback / problem report form. Spam protection: honeypot + time-on-form + server validation. */
(function () {
  'use strict';
  var IG = window.IG, t = IG.t;
  var form = document.getElementById('fb-form'); if (!form) return;
  var typeSel = document.getElementById('fb-type'), msg = document.getElementById('fb-msg'), email = document.getElementById('fb-email'), web = document.getElementById('fb-web');
  var err = document.getElementById('fb-err'), errText = document.getElementById('fb-err-text'), send = document.getElementById('fb-send');
  var done = document.getElementById('fb-done'), again = document.getElementById('fb-again'), stars = document.getElementById('fb-stars');
  var labels = Array.prototype.slice.call(stars.querySelectorAll('label'));
  var openedAt = Date.now(), lastKey = null;

  function rating() { var c = form.querySelector('input[name="rating"]:checked'); return c ? Number(c.value) : 0; }
  function paintStars() { var r = rating(); labels.forEach(function (l, i) { l.classList.toggle('on', i < r); }); }
  function labelStars() { labels.forEach(function (l, i) { l.setAttribute('aria-label', t('fb.star', { n: i + 1 })); }); }
  function syncType() {
    var ty = typeSel.value;
    stars.hidden = ty === 'problem' && false;                 // rating can accompany any type
    msg.required = ty !== 'rating';
  }
  function fail(key) { lastKey = key; errText.textContent = t(key); err.hidden = false; }

  form.addEventListener('change', paintStars);
  typeSel.addEventListener('change', syncType);
  IG.onLang(function () { labelStars(); if (lastKey && !err.hidden) errText.textContent = t(lastKey); });

  form.addEventListener('submit', function (e) {
    e.preventDefault(); err.hidden = true;
    var ty = typeSel.value, r = rating(), m = msg.value.trim(), em = email.value.trim();
    if ((ty === 'rating' && !r) || (ty !== 'rating' && m.length < 5) || (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))) return fail('fb.invalid');
    send.disabled = true; send.firstElementChild.textContent = t('fb.sending');
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: ty, rating: r || undefined, message: m, email: em || undefined, website: web.value, elapsed: Date.now() - openedAt }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok) { form.hidden = true; done.hidden = false; form.reset(); paintStars(); IG.toast(t('fb.ok'), 'ok'); return; }
        fail(res.j.code === 'RATE_LIMIT' ? 'err.RATE_LIMIT' : res.j.code === 'INVALID' || res.j.code === 'SPAM' ? 'fb.invalid' : 'fb.err');
      })
      .catch(function () { fail('err.network'); })
      .then(function () { send.disabled = false; send.firstElementChild.textContent = t('fb.send'); });
  });
  again.addEventListener('click', function () { done.hidden = true; form.hidden = false; openedAt = Date.now(); msg.focus(); });
  syncType(); labelStars();
})();
