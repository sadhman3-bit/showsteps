// Mock identity provider: one-click account tiles, or a password form when the app's session
// has ended (?prompt=login). Sends the person back to the app's callback with a user name.
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const back = params.get('return') || '';
  // Only ever return to the demo app on this machine.
  const safe = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/auth\/callback(\?|$)/.test(back);
  function finish(user) {
    if (!safe) return;
    location.href = back + (back.includes('?') ? '&' : '?') + 'user=' + encodeURIComponent(user);
  }
  if (params.get('prompt') === 'login') {
    document.getElementById('accounts').hidden = true;
    const form = document.getElementById('password-form');
    form.hidden = false;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      finish(form.elements.namedItem('email').value.split('@')[0] || 'demo');
    });
  } else {
    for (const b of document.querySelectorAll('[data-user]'))
      b.addEventListener('click', function () {
        finish(b.dataset.user);
      });
  }
})();
