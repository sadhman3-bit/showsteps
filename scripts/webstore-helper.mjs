// Writes docs/webstore/submit.html: every Chrome Web Store field from LISTING.md with a Copy
// button, for pasting into the developer dashboard (which no extension or embedded browser
// may script). Run: node scripts/webstore-helper.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../docs/webstore/', import.meta.url));
const md = readFileSync(`${dir}LISTING.md`, 'utf8');
const version = JSON.parse(
  readFileSync(fileURLToPath(new URL('../apps/extension/package.json', import.meta.url)), 'utf8'),
).version;
/** The store item, live since 1.0.0. */
const ITEM_ID = 'hlkihjibgiehjcaemfhfnfcjphgkcnoa';
/** Permissions new in this version: their justifications go on the Privacy practices tab. */
const NEW_PERMISSIONS = ['alarms', 'notifications'];
const quote = (after) => {
  const start = md.indexOf(after);
  const lines = md.slice(start).split('\n').slice(1);
  const body = [];
  let begun = false;
  for (const l of lines) {
    if (l.startsWith('>')) {
      begun = true;
      body.push(l.replace(/^> ?/, ''));
    } else if (begun) break;
  }
  return body.join('\n').trim();
};
const line = (label) => md.match(new RegExp(`\\*\\*${label}:\\*\\* (.+)`))?.[1].trim() ?? '';
const perms = [...md.matchAll(/^\| (`[^|]+`[^|]*?|Host permission[^|]*?)\s*\| (.+?) \|$/gm)].map(
  (m) => [m[1].replace(/`/g, '').trim(), m[2].trim()],
);

const fields = [
  ['Store listing', 'Name', line('Name')],
  ['Store listing', 'Summary', quote('**Summary**')],
  ['Store listing', 'Description', quote('**Description:**')],
  ['Store listing', 'Category', line('Category')],
  ['Privacy', 'Single purpose', quote('**Single purpose:**')],
  ...perms.map(([p, why]) => ['Privacy', `Justification: ${p}`, why]),
  ['Privacy', 'Are you using remote code?', 'No'],
  [
    'Privacy',
    'Privacy policy URL',
    md.match(/^\| Privacy policy\s*\| <(https:[^>]+)> \|$/m)?.[1] ?? '',
  ],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let section = '';
const rows = fields
  .map(([sec, label, text], i) => {
    const head = sec !== section ? `<h2>${(section = sec)}</h2>` : '';
    return `${head}<div class="f"><div class="h"><b>${esc(label)}</b><button data-i="${i}">Copy</button></div><pre id="t${i}">${esc(text)}</pre></div>`;
  })
  .join('\n');

writeFileSync(
  `${dir}submit.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShowSteps store fields</title>
<style>
:root { --bg: #faf8f5; --surface: #fff; --text: #1f1c18; --muted: #5c554b; --line: #d9d3ca; --accent: #0f6b62; --on-accent: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #161513; --surface: #1f1d1a; --text: #f2eee8; --muted: #b5ada1; --line: #3d3933; --accent: #4fbfb2; --on-accent: #0b1513; } }
body { margin: 0 auto; max-width: 860px; padding: 24px 16px 64px; background: var(--bg); color: var(--text); font: 15px/1.5 'Segoe UI', system-ui, sans-serif; }
h1 { font-size: 1.4rem; margin: 0 0 4px; } h2 { font-size: 1.05rem; margin: 28px 0 8px; }
p, li { color: var(--muted); }
.f { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
.h { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
pre { white-space: pre-wrap; font: inherit; margin: 6px 0 0; color: var(--muted); max-height: 9em; overflow: auto; }
button { font: inherit; border: 0; border-radius: 6px; padding: 4px 14px; background: var(--accent); color: var(--on-accent); cursor: pointer; }
button.done { opacity: 0.6; }
code { font-family: Consolas, monospace; }
</style></head><body>
<h1>ShowSteps: update the Chrome Web Store item to ${version}</h1>
<p>About 10 minutes. Fields that changed have a Copy button below.</p>
<ol>
<li>Open the developer dashboard, <b>chrome.google.com/webstore/devconsole</b>, then the ShowSteps item (ID <code>${ITEM_ID}</code>).</li>
<li><b>Package</b> tab: <b>Upload new package</b>, and choose <code>dist/showsteps-extension-${version}-chrome-web-store.zip</code>.</li>
<li><b>Store listing</b> tab: paste the new <b>Description</b> (below) and add screenshot <code>docs/webstore/images/4-schedules.png</code>.</li>
<li><b>Privacy practices</b> tab: add the <b>alarms</b> and <b>notifications</b> justifications (below) and check that the data usage ticks are still <b>Website content</b> and <b>User activity</b> with all three statements. The privacy policy URL stays the same; the updated policy is live on <code>main</code>.</li>
<li><b>Submit for review.</b> To choose when it goes live, untick automatic publishing in the confirmation dialog; after approval you have 30 days to press <b>Publish</b>.</li>
</ol>
<h2>Changed in ${version}</h2>
${fields
  .map(([sec, label, text], i) => [sec, label, text, i])
  .filter(
    ([, label]) =>
      label === 'Description' ||
      NEW_PERMISSIONS.some((p) => label.startsWith(`Justification: ${p}`)),
  )
  .map(
    ([, label, text, i]) =>
      `<div class="f"><div class="h"><b>${esc(label)}</b><button data-i="c${i}">Copy</button></div><pre id="tc${i}">${esc(text)}</pre></div>`,
  )
  .join('\n')}
<details><summary><b>Every field (first-time submission)</b></summary>
<p>For a new item: <b>New item</b>, upload the Web Store zip, then copy each field below into the matching box.</p>
<h2>Files to upload</h2>
<ul>
<li>Store icon: <code>apps/extension/public/icon/128.png</code></li>
<li>Screenshots: <code>docs/webstore/images/1-record.png</code>, <code>2-guide.png</code>, <code>3-agent.png</code>, <code>4-schedules.png</code></li>
<li>Small promo tile: <code>docs/webstore/images/promo-440x280.png</code></li>
</ul>
${rows}
<h2>Privacy: data usage</h2>
<p>Tick <b>Website content</b> and <b>User activity</b>, then tick all three statements (not sold; not used for unrelated purposes; not used for creditworthiness or lending). Paste the privacy policy's link into <b>Privacy policy URL</b>.</p>
<h2>Distribution</h2>
<p>Visibility <b>Unlisted</b> · all regions · free. Then <b>Submit for review</b>.</p>
</details>
<script>
// Pages opened from a file may not get the clipboard API: fall back to selecting and copying.
function copyText(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const text = document.getElementById('t' + b.dataset.i).textContent;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = copyText(text);
  }
  b.textContent = ok ? 'Copied' : 'Select and copy';
  b.classList.add('done');
});
</script>
</body></html>
`,
);
console.log(`${fields.length} fields`);
