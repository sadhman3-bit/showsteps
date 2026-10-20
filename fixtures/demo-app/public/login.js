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
  // Single sign-on through the mock identity provider on the second port.
  const xoriginPort = (window.DEMO_CONFIG && window.DEMO_CONFIG.xoriginPort) || 5174;
  const callback = location.origin + '/auth/callback?return=%2Fapp%2F';
  document.getElementById('sso').href =
    'http://127.0.0.1:' + xoriginPort + '/idp/?return=' + encodeURIComponent(callback);
})();
