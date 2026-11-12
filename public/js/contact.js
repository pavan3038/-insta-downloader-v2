(function () {
  'use strict';
  var t = window.IG.t;
  var form = document.getElementById('contact-form'), btn = document.getElementById('c-send');
  var ok = document.getElementById('c-ok'), err = document.getElementById('c-err'), errText = document.getElementById('c-err-text');
  var lastKey = null;
  window.IG.onLang(function () { if (lastKey) errText.textContent = t(lastKey); });
  function fail(key) { lastKey = key; errText.textContent = t(key); err.hidden = false; ok.hidden = true; }

  form.addEventListener('submit', function (e) {
    e.preventDefault(); ok.hidden = true; err.hidden = true; lastKey = null;
    var d = { name: form.name.value.trim(), email: form.email.value.trim(), message: form.message.value.trim(), website: form.website.value };
    if (!d.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || !d.message) return fail('contact.invalid');
    btn.disabled = true; btn.firstElementChild.textContent = t('contact.sending');
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok) { ok.hidden = false; form.reset(); }
        else fail(r.j.code === 'RATE_LIMIT' ? 'err.RATE_LIMIT' : r.j.code === 'INVALID' ? 'contact.invalid' : 'err.generic');
      })
      .catch(function () { fail('err.network'); })
      .then(function () { btn.disabled = false; btn.firstElementChild.textContent = t('contact.send'); });
  });
})();
