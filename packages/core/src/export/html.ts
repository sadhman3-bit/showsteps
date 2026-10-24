import { CHROME, DARK, LIGHT } from '../tokens.js';
import { trailSvg } from '../patterns.js';
import { WEB_DISPLAY_700, WEB_SANS_400, WEB_SANS_600 } from './fonts.generated.js';
import { BRAND_FONTS, HIGHLIGHT_COLOR, accentOf, fontOf, textOn } from '../branding.js';
import { PROCEDURE_FORMAT, procedureJson, toProcedure } from '../agent/procedure.js';
import { escapeHtml, toHtml, toPlainText } from '../richText.js';
import {
  dataUri,
  exportDocument,
  type ExportDocument,
  type ExportInput,
  type ExportItem,
} from './model.js';

/**
 * U3: the structured procedure as a JSON data block. Browsers never run `application/json`
 * script elements, and the page's CSP allows no scripts at all.
 */
function procedureScript(input: ExportInput): string {
  return `<script type="application/json" id="${PROCEDURE_FORMAT}">${procedureJson(toProcedure(input.guide))}</script>`;
}

/** Exported pages run no scripts and load nothing: images are inline. */
const CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const TONES = {
  light: { tip: LIGHT.tip, note: LIGHT.note, warning: LIGHT.warning, alert: LIGHT.alert },
  dark: { tip: DARK.tip, note: DARK.note, warning: DARK.warning, alert: DARK.alert },
};

function fontStack(input: ExportInput): string {
  return BRAND_FONTS[fontOf(input.guide) ?? 'Funnel Sans'] ?? 'system-ui, sans-serif';
}

/** The guide uses ShowSteps's own type (no branding font chosen). */
function usesFunnel(input: ExportInput): boolean {
  return (fontOf(input.guide) ?? 'Funnel Sans') === 'Funnel Sans';
}

const face = (family: string, weight: number, data: string) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`;

/** Funnel Sans (400, 600) and Funnel Display (700), embedded so the page needs no network. */
function fontCss(input: ExportInput): string {
  if (!usesFunnel(input)) return '';
  return [
    face('Funnel Sans', 400, WEB_SANS_400),
    face('Funnel Sans', 600, WEB_SANS_600),
    face('Funnel Display', 700, WEB_DISPLAY_700),
  ].join('\n');
}

const DISPLAY = "'Funnel Display','Funnel Sans',system-ui,sans-serif";

function head(title: string, css: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="ShowSteps">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    '</head>',
  ].join('\n');
}

function img(src: string, alt: string, width: number, height: number, cls = ''): string {
  return `<img${cls ? ` class="${cls}"` : ''} src="${src}" alt="${escapeHtml(alt)}" width="${width}" height="${height}">`;
}

function themeCss(input: ExportInput): string {
  const accent = accentOf(input.guide);
  const heading = usesFunnel(input) ? DISPLAY : 'inherit';
  return `${fontCss(input)}
:root{color-scheme:light dark;--accent:${accent};--on-accent:${textOn(accent)};--highlight:${HIGHLIGHT_COLOR};--bg:${LIGHT.bg};--surface:${LIGHT.surface};--border:${LIGHT.line};--text:${LIGHT.text};--muted:${LIGHT.textMuted};--tip:${TONES.light.tip};--note:${TONES.light.note};--warning:${TONES.light.warning};--alert:${TONES.light.alert};--tip-bg:${LIGHT.tipBg};--note-bg:${LIGHT.noteBg};--warning-bg:${LIGHT.warningBg};--alert-bg:${LIGHT.alertBg};--heading:${heading};font-family:${fontStack(input)}}
@media (prefers-color-scheme:dark){:root{--bg:${DARK.bg};--surface:${DARK.surface};--border:${DARK.line};--text:${DARK.text};--muted:${DARK.textMuted};--tip:${TONES.dark.tip};--note:${TONES.dark.note};--warning:${TONES.dark.warning};--alert:${TONES.dark.alert};--tip-bg:color-mix(in srgb,${DARK.tip} 14%,${DARK.surface});--note-bg:color-mix(in srgb,${DARK.note} 14%,${DARK.surface});--warning-bg:color-mix(in srgb,${DARK.warning} 14%,${DARK.surface});--alert-bg:color-mix(in srgb,${DARK.alert} 14%,${DARK.surface})}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit}
img{max-width:100%;height:auto}
h1,h2{font-family:var(--heading);letter-spacing:-.02em}
.callout{margin:0;padding:12px 16px;border-radius:12px;background:var(--tone-bg);color:var(--text)}
.callout strong{color:var(--tone)}
.callout--tip{--tone:var(--tip);--tone-bg:var(--tip-bg)}.callout--note{--tone:var(--note);--tone-bg:var(--note-bg)}.callout--warning{--tone:var(--warning);--tone-bg:var(--warning-bg)}.callout--alert{--tone:var(--alert);--tone-bg:var(--alert-bg)}
.num{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:28px;height:28px;padding:0 6px;border-radius:14px;background:var(--accent);color:var(--on-accent);font-family:var(--heading);font-weight:700;font-size:15px;text-decoration:none}
.shot{display:block;border:1px solid var(--border);border-radius:12px;background:${LIGHT.surface}}`;
}

/** The cover band: the Trail pattern on navy with the title in white. */
function coverCss(): string {
  return `.cover{position:relative;overflow:hidden;margin:0 0 20px;padding:40px 32px;border-radius:16px;background:${CHROME.bg};color:${CHROME.fg}}
.cover__art{position:absolute;inset:0 0 0 35%}
.cover__art svg{display:block;width:100%;height:100%}
.cover::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,${CHROME.bg} 32%,transparent 80%)}
.cover h1{position:relative;z-index:1;max-width:60%;margin:0;color:${CHROME.fg}}
@media (max-width:820px){.cover h1{max-width:none}.cover__art{opacity:.35;left:0}}
@media print{.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
}

const PAGE_CSS = `
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:40px;max-width:1180px;margin:0 auto;padding:32px 24px}
.toc{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;font-size:14px}
.toc p{margin:0 0 8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--muted)}
.toc ol{list-style:none;margin:0;padding:0}
.toc li{margin:2px 0}
.toc a{display:flex;gap:8px;padding:4px 8px;border-radius:6px;text-decoration:none}
.toc a:hover,.toc a:focus-visible{background:var(--surface)}
.toc .toc__section{margin-top:12px;font-weight:700}
.toc .toc__n{color:var(--muted);min-width:1.6em;text-align:right}
header{margin-bottom:24px}
.logo{display:block;max-height:56px;width:auto;margin-bottom:16px}
h1{font-size:30px;line-height:1.2;margin:0 0 8px}\n${coverCss()}
.desc{font-size:17px;margin:0 0 8px}
.meta{color:var(--muted);margin:0}
.links{margin:0}.links small{display:block;color:var(--muted)}
.before{margin:16px 0 0;padding:12px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.before h2{font-size:15px;margin:0 0 4px}
.before ul{margin:0;padding-left:20px}
main>h2{display:inline-block;font-size:24px;line-height:1.25;margin:40px 0 12px;box-shadow:inset 0 -.35em 0 color-mix(in srgb,var(--highlight) 35%,transparent)}
main>.callout{margin:16px 0}
.step{margin:20px 0;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface);scroll-margin-top:16px}
.step:target{outline:3px solid var(--highlight);outline-offset:2px}
.step__head{display:flex;gap:12px;align-items:flex-start}
.step h3{margin:2px 0 0;font-size:17px;font-weight:400}.step h3 strong{font-weight:600}
.step__desc{margin:8px 0 0 40px}
.step figure{margin:12px 0 0 40px}
.step__nav{display:flex;justify-content:space-between;margin:10px 0 0 40px;font-size:13px;color:var(--muted)}
.step__nav a{text-decoration:none}
.step__nav a:hover{text-decoration:underline}
.done{margin:32px 0 0;padding:12px 16px;border-radius:8px;background:color-mix(in srgb,var(--accent) 12%,var(--surface))}
.agent-note{margin:32px 0 0;color:var(--muted);font-size:12px}
@media (max-width:820px){.layout{display:block;padding:16px}.toc{position:static;max-height:none;margin-bottom:24px}.step__desc,.step figure,.step__nav{margin-left:0}}
@media print{:root{--bg:${LIGHT.surface};--surface:${LIGHT.surface};--text:${LIGHT.text}}.layout{display:block;padding:0;max-width:none}.toc,.step__nav{display:none}.step{break-inside:avoid;border:0;padding:0;margin:16px 0}.step:target{outline:0}main>h2{break-after:avoid}.shot{max-height:16cm;width:auto}a{text-decoration:none}}`;

function titleHtml(item: Extract<ExportItem, { kind: 'step' }>): string {
  return toHtml(item.title) || escapeHtml(item.titleText);
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function calloutHtml(item: Extract<ExportItem, { kind: 'callout' }>, tag = 'aside'): string {
  return `<${tag} class="callout callout--${item.tone}"><strong>${escapeHtml(item.label)}:</strong> ${multiline(item.text)}</${tag}>`;
}

/** "Open in ShowSteps: Guide Me · Run for me" and its note, when the guide has links (1.2). */
function linksHtml(doc: ExportDocument, style = ''): string {
  if (!doc.links) return '';
  const L = doc.labels;
  const a = (href: string, text: string) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  return `<p class="links"${style ? ` style="${style}"` : ''}>${escapeHtml(L.openIn)} ${a(doc.links.guide, L.guideMe)} · ${a(doc.links.run, L.runForMe)}<br><small>${escapeHtml(L.linksNote)}</small></p>`;
}

function headerHtml(input: ExportInput, doc: ExportDocument): string {
  const parts = ['<header>'];
  if (input.logo)
    parts.push(img(dataUri(input.logo), '', input.logo.width, input.logo.height, 'logo'));
  parts.push(
    `<div class="cover"><div class="cover__art" aria-hidden="true">${trailSvg()}</div><h1>${escapeHtml(doc.title)}</h1></div>`,
  );
  if (doc.links) parts.push(linksHtml(doc));
  if (doc.description) parts.push(`<p class="desc">${multiline(doc.description)}</p>`);
  parts.push(`<p class="meta">${escapeHtml(doc.meta)}</p>`);
  if (doc.preconditions.length) {
    parts.push(
      `<section class="before"><h2>${escapeHtml(doc.labels.before)}</h2><ul>${doc.preconditions
        .map((p) => `<li>${escapeHtml(p)}</li>`)
        .join('')}</ul></section>`,
    );
  }
  parts.push('</header>');
  return parts.join('\n');
}

/** X4: one self-contained page with step navigation, deep links, dark mode and print styles. */
export function guideToHtml(input: ExportInput): string {
  const doc = exportDocument(input);
  const L = doc.labels;
  const steps = doc.items.filter((i) => i.kind === 'step');
  const toc = doc.items
    .map((item) => {
      if (item.kind === 'heading')
        return `<li class="toc__section"><a href="#${item.anchor}">${escapeHtml(item.text)}</a></li>`;
      if (item.kind === 'step')
        return `<li><a href="#${item.anchor}"><span class="toc__n">${item.number}</span><span>${escapeHtml(item.titleText)}</span></a></li>`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
  const body = doc.items.map((item) => {
    if (item.kind === 'heading') return `<h2 id="${item.anchor}">${escapeHtml(item.text)}</h2>`;
    if (item.kind === 'callout') return calloutHtml(item);
    const i = steps.indexOf(item);
    const prev = steps[i - 1];
    const next = steps[i + 1];
    return [
      `<article class="step" id="${item.anchor}" data-step-id="${escapeHtml(item.id)}">`,
      `<div class="step__head"><a class="num" href="#${item.anchor}" aria-label="${escapeHtml(L.step(item.number))}">${item.number}</a><h3>${titleHtml(item)}</h3></div>`,
      item.description ? `<p class="step__desc">${toHtml(item.description)}</p>` : '',
      item.image
        ? `<figure>${img(dataUri(item.image), item.alt, item.image.width, item.image.height, 'shot')}</figure>`
        : '',
      `<nav class="step__nav">${prev ? `<a href="#${prev.anchor}">← ${escapeHtml(L.previous)}</a>` : '<span></span>'}${next ? `<a href="#${next.anchor}">${escapeHtml(L.next)} →</a>` : `<a href="#top">${escapeHtml(L.top)} ↑</a>`}</nav>`,
      '</article>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    head(doc.title, themeCss(input) + PAGE_CSS),
    '<body id="top">',
    '<div class="layout">',
    `<nav class="toc" aria-label="${escapeHtml(L.contents)}"><p>${escapeHtml(L.contents)}</p><ol>`,
    toc,
    '</ol></nav>',
    '<main>',
    headerHtml(input, doc),
    doc.items.length ? '' : `<p>${escapeHtml(L.noSteps)}</p>`,
    ...body,
    doc.success
      ? `<p class="done"><strong>${escapeHtml(L.success)}:</strong> ${escapeHtml(doc.success)}</p>`
      : '',
    `<footer class="agent-note">${escapeHtml(L.agentFooter)}</footer>`,
    '</main>',
    '</div>',
    procedureScript(input),
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');
}

const EMBED_CSS = `
body{background:var(--surface);font-size:15px}
.card{max-width:960px;margin:0 auto;padding:16px}
.card__head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.logo{max-height:32px;width:auto}
h1{font-size:18px;margin:0;line-height:1.3}
.meta{margin:0;color:var(--muted);font-size:13px}
.links{margin:4px 0 0;font-size:13px}.links small{display:block;color:var(--muted)}
.slide{display:none}
.slide:target,.slides:not(:has(.slide:target)) .slide:first-child{display:block}
.slide__head{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px}
.slide h2{font-size:16px;font-weight:600;margin:2px 0 0}
.slide__count{margin:0 0 6px;color:var(--muted);font-size:13px}
.slide__desc{margin:0 0 10px}
.slide .callout{margin:0 0 10px}
.pager{display:flex;justify-content:space-between;margin-top:10px}
.pager a{padding:6px 12px;border:1px solid var(--border);border-radius:6px;text-decoration:none;font-size:14px}
.pager a:hover{border-color:var(--accent)}
.pager span{visibility:hidden}`;

/**
 * X6: a compact card for an iframe (for example a SharePoint Embed web part). One step at a
 * time with Previous / Next links; no scripts, so it works under strict page policies.
 */
export function guideToEmbedHtml(input: ExportInput): string {
  const doc = exportDocument(input);
  const L = doc.labels;
  const steps = doc.items.filter((i) => i.kind === 'step');
  // Callouts and headings show on the step that follows them.
  const before = new Map<string, string[]>();
  let pending: string[] = [];
  for (const item of doc.items) {
    if (item.kind === 'step') {
      before.set(item.id, pending);
      pending = [];
    } else if (item.kind === 'callout') {
      pending.push(calloutHtml(item, 'p'));
    } else {
      pending.push(`<p class="slide__count"><strong>${escapeHtml(item.text)}</strong></p>`);
    }
  }
  const slides = steps.map((item, i) => {
    const prev = steps[i - 1];
    const next = steps[i + 1];
    return [
      `<section class="slide" id="${item.anchor}">`,
      ...(before.get(item.id) ?? []),
      `<p class="slide__count">${escapeHtml(L.stepOf(item.number, doc.stepCount))}</p>`,
      `<div class="slide__head"><span class="num">${item.number}</span><h2>${titleHtml(item)}</h2></div>`,
      item.description ? `<p class="slide__desc">${toHtml(item.description)}</p>` : '',
      item.image
        ? img(dataUri(item.image), item.alt, item.image.width, item.image.height, 'shot')
        : '',
      `<nav class="pager">${prev ? `<a href="#${prev.anchor}">← ${escapeHtml(L.previous)}</a>` : '<span></span>'}${next ? `<a href="#${next.anchor}">${escapeHtml(L.next)} →</a>` : '<span></span>'}</nav>`,
      '</section>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    head(doc.title, themeCss(input) + EMBED_CSS),
    '<body>',
    '<div class="card">',
    `<div class="card__head">${input.logo ? img(dataUri(input.logo), '', input.logo.width, input.logo.height, 'logo') : ''}<div><h1>${escapeHtml(doc.title)}</h1><p class="meta">${escapeHtml(doc.meta)}</p>${linksHtml(doc)}</div></div>`,
    '<div class="slides">',
    ...(slides.length ? slides : [`<p>${escapeHtml(L.noSteps)}</p>`]),
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');
}

/** Width of pictures in pasted documents, in CSS pixels (fits Word and email bodies). */
const CLIP_WIDTH = 600;

const CLIP_TONE_BG = {
  tip: LIGHT.tipBg,
  note: LIGHT.noteBg,
  warning: LIGHT.warningBg,
  alert: LIGHT.alertBg,
};

/**
 * X5: HTML for the clipboard. Inline styles only and plain structure, because Word, Outlook,
 * OneNote, Teams, Confluence and Notion each keep a different subset of HTML.
 */
export function guideToClipboardHtml(input: ExportInput): string {
  const doc = exportDocument(input);
  const L = doc.labels;
  const accent = accentOf(input.guide);
  const font = fontStack(input).replace(/"/g, "'");
  const out: string[] = [`<div style="font-family:${font};color:${LIGHT.text};line-height:1.5">`];
  if (input.logo) {
    const h = 48;
    const w = Math.round((input.logo.width / input.logo.height) * h);
    out.push(`<p>${img(dataUri(input.logo), '', w, h)}</p>`);
  }
  out.push(`<h1 style="margin:0 0 6px">${escapeHtml(doc.title)}</h1>`);
  if (doc.links) out.push(linksHtml(doc, 'margin:0 0 6px'));
  if (doc.description) out.push(`<p style="margin:0 0 6px">${multiline(doc.description)}</p>`);
  out.push(`<p style="margin:0 0 12px;color:${LIGHT.textMuted}">${escapeHtml(doc.meta)}</p>`);
  if (doc.preconditions.length) {
    out.push(`<p style="margin:12px 0 4px"><strong>${escapeHtml(L.before)}</strong></p>`);
    out.push(`<ul>${doc.preconditions.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`);
  }
  for (const item of doc.items) {
    if (item.kind === 'heading') {
      out.push(
        `<h2 style="margin:20px 0 8px;color:${LIGHT.text}" id="${item.anchor}">${escapeHtml(item.text)}</h2>`,
      );
    } else if (item.kind === 'callout') {
      const tone = TONES.light[item.tone];
      out.push(
        `<p style="margin:10px 0;padding:10px 14px;border-radius:12px;background:${CLIP_TONE_BG[item.tone]}"><strong style="color:${tone}">${escapeHtml(item.label)}:</strong> ${multiline(item.text)}</p>`,
      );
    } else {
      out.push(
        `<p style="margin:16px 0 4px"><strong style="color:${accent}">${item.number}.</strong> ${titleHtml(item)}</p>`,
      );
      if (item.description) out.push(`<p style="margin:0 0 6px">${toHtml(item.description)}</p>`);
      if (item.image) {
        const w = Math.min(CLIP_WIDTH, item.image.width);
        const h = Math.round((item.image.height / item.image.width) * w);
        out.push(`<p style="margin:6px 0 12px">${img(dataUri(item.image), item.alt, w, h)}</p>`);
      }
    }
  }
  if (doc.success)
    out.push(`<p><strong>${escapeHtml(L.success)}:</strong> ${escapeHtml(doc.success)}</p>`);
  out.push('</div>');
  return out.join('\n');
}

/** Plain-text companion for the clipboard (`text/plain`). */
export function guideToText(input: ExportInput): string {
  const doc = exportDocument(input);
  const L = doc.labels;
  const out: string[] = [doc.title];
  if (doc.description) out.push(doc.description);
  if (doc.preconditions.length)
    out.push(`${L.before}:\n${doc.preconditions.map((p) => `- ${p}`).join('\n')}`);
  for (const item of doc.items) {
    if (item.kind === 'heading') out.push(item.text.toUpperCase());
    else if (item.kind === 'callout') out.push(`${item.label}: ${item.text}`);
    else
      out.push(
        `${item.number}. ${item.titleText}${item.description ? `\n   ${toPlainText(item.description)}` : ''}`,
      );
  }
  if (doc.success) out.push(`${L.success}: ${doc.success}`);
  return out.join('\n\n') + '\n';
}
