// Ledgerline SPA: history-API routing between dashboard, new invoice and confirmation.
(function () {
  'use strict';

  const view = document.getElementById('view');
  const dialog = document.getElementById('review-dialog');
  const xoriginPort = (window.DEMO_CONFIG && window.DEMO_CONFIG.xoriginPort) || 5174;
  const xorigin = 'http://127.0.0.1:' + xoriginPort;
  let lastSubmitted = null;

  const sso = /(?:^|;\s*)demo_session=([^;]*)/.exec(document.cookie);
  document.getElementById('who').textContent =
    'Signed in as ' + (sessionStorage.getItem('demoUser') || (sso && sso[1]) || 'guest');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Views ----------

  function dashboard() {
    view.innerHTML =
      '<section class="panel" aria-labelledby="dash-h">' +
      '  <h1 id="dash-h">Dashboard</h1>' +
      '  <p>Welcome back. You have invoices waiting.</p>' +
      '  <button type="button" class="primary" data-testid="new-invoice">New invoice</button>' +
      '</section>' +
      '<section class="panel" aria-labelledby="recent-h">' +
      '  <h2 id="recent-h">Recent invoices</h2>' +
      '  <div id="recent" data-stable-id aria-live="polite"><p class="loading">Loading recent invoices…</p></div>' +
      '</section>' +
      '<section class="panel" aria-labelledby="contact-h" data-sensitive-demo>' +
      '  <h2 id="contact-h">Supplier contact</h2>' +
      '  <table><tbody>' +
      '    <tr><th scope="row">Email</th><td>accounts@saltbush-supplies.example</td></tr>' +
      '    <tr><th scope="row">Phone</th><td>0412 345 678</td></tr>' +
      '    <tr><th scope="row">Card on file</th><td>4111 1111 1111 1111</td></tr>' +
      '    <tr><th scope="row">BSB / Account</th><td>123-456 / 98765432</td></tr>' +
      '    <tr><th scope="row">TFN</th><td>123 456 782</td></tr>' +
      '    <tr><th scope="row">ABN</th><td>51 824 753 556</td></tr>' +
      '    <tr><th scope="row">IBAN</th><td>GB82 WEST 1234 5698 7654 32</td></tr>' +
      '  </tbody></table>' +
      '</section>';
    window.demoScramble(view);
    view.querySelector('[data-testid="new-invoice"]').addEventListener('click', function () {
      navigate('/app/invoices/new');
    });
    loadRecent();
  }

  function loadRecent() {
    fetch('/api/recent-invoices')
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        const box = document.getElementById('recent');
        if (!box) return; // navigated away
        box.innerHTML =
          '<table><thead><tr><th>Number</th><th>Supplier</th><th>Amount</th></tr></thead><tbody>' +
          rows
            .map(function (r) {
              return (
                '<tr><td>' +
                esc(r.number) +
                '</td><td>' +
                esc(r.supplier) +
                '</td><td>$' +
                r.amount.toFixed(2) +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table>';
        box.setAttribute('data-loaded', 'true');
      });
  }

  function newInvoice() {
    view.innerHTML =
      '<section class="panel" aria-labelledby="new-h">' +
      '<h1 id="new-h">New invoice</h1>' +
      '<form id="invoice-form" data-stable-id novalidate>' +
      '  <div class="field"><label for="supplier">Supplier</label>' +
      '    <input id="supplier" name="supplier" required /></div>' +
      '  <div class="field"><label for="invno">Invoice no.</label>' +
      '    <input id="invno" name="invoiceNumber" placeholder="e.g. INV-1043" required /></div>' +
      '  <div class="field"><label for="amount">Amount</label>' +
      '    <input id="amount" name="amount" type="number" step="0.01" min="0" inputmode="decimal" /></div>' +
      '  <div class="field"><label for="currency">Currency</label>' +
      '    <select id="currency" name="currency">' +
      '      <option value="AUD">AUD</option><option value="NZD">NZD</option><option value="USD">USD</option>' +
      '    </select></div>' +
      '  <div class="field"><label for="invdate">Invoice date</label>' +
      '    <input id="invdate" name="invoiceDate" type="date" /></div>' +
      '  <div class="field"><label><input type="checkbox" name="gst" /> Includes GST</label>' +
      '    <label><input type="checkbox" name="urgent" /> Urgent</label></div>' +
      '  <fieldset><legend>Payment method</legend>' +
      '    <label><input type="radio" name="pay" value="eft" checked /> EFT</label>' +
      '    <label><input type="radio" name="pay" value="cheque" /> Cheque</label>' +
      '    <label><input type="radio" name="pay" value="card" /> Card</label>' +
      '    <div class="field" id="card-field" data-stable-id hidden>' +
      '      <label for="cardno">Card number</label>' +
      '      <input id="cardno" name="cardNumber" autocomplete="cc-number" inputmode="numeric" />' +
      '    </div>' +
      '  </fieldset>' +
      '  <div class="field"><label for="attach">Attach invoice PDF</label>' +
      '    <input id="attach" name="attachment" type="file" accept=".pdf,image/*" /></div>' +
      '  <div class="field"><label for="costcentre">Cost centre</label>' +
      '    <input id="costcentre" name="costCentre" readonly placeholder="Pick one below" />' +
      '    <iframe title="Cost centre lookup" src="' +
      xorigin +
      '/widget.html" height="120"></iframe></div>' +
      '  <div class="field"><span>Internal note</span>' +
      '    <iframe title="Internal note" src="/frames/notes.html" height="140"></iframe></div>' +
      '  <div class="field"><span id="approver-label">Approver</span>' +
      '    <ss-approver-picker aria-labelledby="approver-label"></ss-approver-picker></div>' +
      '  <button type="submit" class="primary">Review invoice</button>' +
      '</form></section>';
    window.demoScramble(view);

    const form = document.getElementById('invoice-form');
    form.addEventListener('change', function (e) {
      if (e.target.name === 'pay') {
        form.querySelector('[data-stable-id]').hidden = e.target.value !== 'card';
      }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      openReview(form);
    });
  }

  function done() {
    const inv = lastSubmitted || { invoiceNumber: '(unknown)' };
    view.innerHTML =
      '<section class="panel" role="status" aria-labelledby="done-h">' +
      '<h1 id="done-h">Invoice submitted</h1>' +
      '<p>Invoice <strong>' +
      esc(inv.invoiceNumber) +
      '</strong> was sent for approval.</p>' +
      '<a href="/app/" data-link>Back to dashboard</a></section>';
    window.demoScramble(view);
  }

  // ---------- Review dialog ----------

  function readForm(form) {
    const data = new FormData(form);
    const notesFrame = form.querySelector('iframe[title="Internal note"]');
    const note =
      notesFrame && notesFrame.contentDocument
        ? notesFrame.contentDocument.querySelector('textarea').value
        : '';
    const picker = form.querySelector('ss-approver-picker');
    return {
      supplier: data.get('supplier'),
      invoiceNumber: data.get('invoiceNumber'),
      amount: data.get('amount'),
      currency: data.get('currency'),
      invoiceDate: data.get('invoiceDate'),
      costCentre: data.get('costCentre'),
      approver: picker ? picker.value : '',
      note: note,
    };
  }

  function openReview(form) {
    const inv = readForm(form);
    const rows = [
      ['Supplier', inv.supplier],
      ['Invoice no.', inv.invoiceNumber],
      ['Amount', (inv.amount || '0') + ' ' + inv.currency],
      ['Cost centre', inv.costCentre || '—'],
      ['Approver', inv.approver || '—'],
    ];
    document.getElementById('review-summary').innerHTML = rows
      .map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1] || '—') + '</dd>';
      })
      .join('');
    dialog.dataset.pending = JSON.stringify(inv);
    dialog.showModal();
  }

  document.getElementById('review-back').addEventListener('click', function () {
    dialog.close();
  });
  document.getElementById('review-submit').addEventListener('click', function () {
    lastSubmitted = JSON.parse(dialog.dataset.pending || '{}');
    dialog.close();
    navigate('/app/invoices/done');
  });

  // ---------- Cross-origin widget messages ----------

  window.addEventListener('message', function (e) {
    if (e.origin !== xorigin) return;
    if (!e.data || e.data.type !== 'cost-centre' || typeof e.data.value !== 'string') return;
    const field = document.querySelector('input[name="costCentre"]');
    if (field) field.value = e.data.value;
  });

  // ---------- Router ----------

  const routes = {
    '/app/': dashboard,
    '/app': dashboard,
    '/app/invoices/new': newInvoice,
    '/app/invoices/done': done,
  };

  function render() {
    (routes[location.pathname] || dashboard)();
  }

  function navigate(path) {
    history.pushState(null, '', path);
    render();
  }

  document.addEventListener('click', function (e) {
    const a = e.target.closest && e.target.closest('a[data-link]');
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);

  window.demoScramble(document.querySelector('header'));
  render();
})();
