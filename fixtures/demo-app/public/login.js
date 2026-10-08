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
})();
