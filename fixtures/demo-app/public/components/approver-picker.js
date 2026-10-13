// <ss-approver-picker>: a web component whose controls live in an open shadow root.
(function () {
  'use strict';
  const APPROVERS = ['Priya Raman', 'Tom Whitlock', 'Mei Chen', 'Lachlan Ward'];

  class ApproverPicker extends HTMLElement {
    constructor() {
      super();
      this._value = '';
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' +
        ':host{display:block}' +
        'input{padding:8px;border:1px solid #d6dbe6;border-radius:6px;font:inherit;width:100%;box-sizing:border-box}' +
        'ul{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}' +
        'button{font:inherit;padding:4px 10px;border-radius:999px;border:1px solid #3b3fb6;background:#fff;color:#3b3fb6;cursor:pointer}' +
        'button[aria-pressed="true"]{background:#3b3fb6;color:#fff}' +
        '</style>' +
        '<input type="search" aria-label="Search approvers" placeholder="Search approvers" />' +
        '<ul role="list"></ul>';
      this._input = root.querySelector('input');
      this._list = root.querySelector('ul');
      this._input.addEventListener('input', () => this._renderList());
      this._renderList();
    }

    get value() {
      return this._value;
    }

    _renderList() {
      const q = this._input.value.trim().toLowerCase();
      this._list.innerHTML = '';
      APPROVERS.filter((n) => n.toLowerCase().includes(q)).forEach((name) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.setAttribute('aria-pressed', String(name === this._value));
        b.addEventListener('click', () => {
          this._value = name;
          this._renderList();
          this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        });
        li.appendChild(b);
        this._list.appendChild(li);
      });
    }
  }

  customElements.define('ss-approver-picker', ApproverPicker);
})();
