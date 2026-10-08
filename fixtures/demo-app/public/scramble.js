// Gives elements random IDs and class names on every load, so tests prove
// Trailmark's selectors never depend on them. Labels are re-pointed so they still work.
(function () {
  'use strict';
  function rnd() {
    return Math.random().toString(36).slice(2, 9);
  }
  function scramble(root) {
    const idMap = new Map();
    root.querySelectorAll('[id]').forEach(function (el) {
      if (el.hasAttribute('data-stable-id')) return;
      const next = 'x' + rnd();
      idMap.set(el.id, next);
      el.id = next;
    });
    root.querySelectorAll('label[for]').forEach(function (label) {
      const next = idMap.get(label.htmlFor);
      if (next) label.htmlFor = next;
    });
    root
      .querySelectorAll('input, select, textarea, button, a, td, h1, h2, section')
      .forEach(function (el) {
        el.classList.add('c-' + rnd());
      });
  }
  window.demoScramble = scramble;
})();
