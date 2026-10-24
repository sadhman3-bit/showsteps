(function () {
  'use strict';
  window.demoScramble(document);
  const form = document.querySelector('form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const user = form.elements.namedItem('username').value.trim() || 'demo';
    sessionStorage.setItem('demoUser', user);
    // Full page load into the SPA.
    window.location.href = '/app/';
  });
  // Show password: the field becomes type="text" (security tests: its value is still secret).
  const show = document.getElementById('show-password');
  show.addEventListener('click', function () {
    const field = form.elements.namedItem('password');
    const shown = field.type === 'password';
    field.type = shown ? 'text' : 'password';
    show.setAttribute('aria-pressed', String(shown));
    show.textContent = shown ? 'Hide password' : 'Show password';
  });
  // Single sign-on through the mock identity provider on the second port.
  const xoriginPort = (window.DEMO_CONFIG && window.DEMO_CONFIG.xoriginPort) || 5174;
  const callback = location.origin + '/auth/callback?return=%2Fapp%2F';
  document.getElementById('sso').href =
    'http://127.0.0.1:' + xoriginPort + '/idp/?return=' + encodeURIComponent(callback);
})();
