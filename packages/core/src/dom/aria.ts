// Practical subset of WAI-ARIA implicit roles and the accessible-name algorithm (accname 1.2).
// Uses only the nodes it is given: no DOM globals, no instanceof (works across frames).

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export const tagOf = (el: Element): string => el.localName.toLowerCase();

export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

const INPUT_ROLES: Record<string, string> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  file: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
  email: 'textbox',
  tel: 'textbox',
  text: 'textbox',
  url: 'textbox',
  password: 'textbox',
  date: 'textbox',
  'datetime-local': 'textbox',
  month: 'textbox',
  week: 'textbox',
  time: 'textbox',
  color: 'textbox',
};

const TAG_ROLES: Record<string, string> = {
  button: 'button',
  textarea: 'textbox',
  option: 'option',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  dialog: 'dialog',
  table: 'table',
  tr: 'row',
  td: 'cell',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  details: 'group',
  fieldset: 'group',
  progress: 'progressbar',
  output: 'status',
  summary: 'button',
  menu: 'list',
  hr: 'separator',
  dl: 'list',
  dt: 'term',
  dd: 'definition',
  meter: 'meter',
};

/** Computed role: explicit `role` first, then the implicit role of the tag. */
export function getRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = tagOf(el);
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : undefined;
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'hidden') return undefined;
      if (el.hasAttribute('list') && INPUT_ROLES[type] === 'textbox') return 'combobox';
      return INPUT_ROLES[type] ?? 'textbox';
    }
    case 'select': {
      const size = Number(el.getAttribute('size') ?? 0);
      return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
    }
    case 'img':
      return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    case 'th':
      return el.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    case 'section':
    case 'form':
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')
        ? tag === 'form'
          ? 'form'
          : 'region'
        : undefined;
    default:
      if (
        el.getAttribute('contenteditable') === 'true' ||
        el.getAttribute('contenteditable') === ''
      ) {
        return 'textbox';
      }
      return TAG_ROLES[tag];
  }
}

/** Roles whose name comes from their content (accname "name from content"). */
const NAME_FROM_CONTENT = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'checkbox',
  'radio',
  'switch',
  'heading',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'row',
  'treeitem',
  'tooltip',
  'listitem',
  'term',
]);

const FORM_CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

export function isFormControl(el: Element): boolean {
  return FORM_CONTROL_TAGS.has(tagOf(el));
}

function isHiddenForName(el: Element): boolean {
  const tag = tagOf(el);
  return (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'template' ||
    tag === 'noscript' ||
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true'
  );
}

type RootLike = { getElementById(id: string): Element | null };

function rootOf(el: Element): RootLike | undefined {
  const root = el.getRootNode() as unknown as Partial<RootLike>;
  return typeof root.getElementById === 'function' ? (root as RootLike) : undefined;
}

/** Text of a subtree for naming: includes img alt text and nested control values, skips hidden parts. */
export function textFromContent(el: Element, skip?: Element, depth = 0): string {
  if (depth > 20) return '';
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.textContent ?? '');
    } else if (node.nodeType === ELEMENT_NODE) {
      const child = node as Element;
      if (child === skip || isHiddenForName(child)) continue;
      const tag = tagOf(child);
      if (tag === 'img') parts.push(child.getAttribute('alt') ?? '');
      else if (tag === 'select' || tag === 'input' || tag === 'textarea') continue;
      else if (tag === 'br') parts.push(' ');
      else {
        const label = child.getAttribute('aria-label');
        parts.push(label ? ` ${label} ` : textFromContent(child, skip, depth + 1));
      }
    }
  }
  return parts.join('');
}

function labelledByText(el: Element): string | undefined {
  const ids = el.getAttribute('aria-labelledby')?.trim();
  if (!ids) return undefined;
  const root = rootOf(el);
  if (!root) return undefined;
  const text = ids
    .split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter((x): x is Element => !!x)
    .map((ref) => ref.getAttribute('aria-label') ?? textFromContent(ref))
    .join(' ');
  return normalizeText(text) || undefined;
}

/** Text of all <label> elements associated with a form control. */
export function labelText(el: Element): string | undefined {
  if (!isFormControl(el)) return undefined;
  const labels: Element[] = [];
  const id = el.getAttribute('id');
  const root = el.getRootNode() as unknown as {
    querySelectorAll?: (s: string) => ArrayLike<Element>;
  };
  if (id && root.querySelectorAll) {
    for (const l of Array.from(root.querySelectorAll('label[for]'))) {
      if (l.getAttribute('for') === id) labels.push(l);
    }
  }
  const wrapping = el.closest('label');
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
  const text = labels.map((l) => textFromContent(l, el)).join(' ');
  return normalizeText(text) || undefined;
}

/** Accessible name, following the accname priority order. */
export function getAccessibleName(el: Element): string {
  const byRef = labelledByText(el);
  if (byRef) return byRef;
  const aria = normalizeText(el.getAttribute('aria-label'));
  if (aria) return aria;

  const tag = tagOf(el);
  const type = (el.getAttribute('type') ?? '').toLowerCase();

  if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) {
    const value = normalizeText(el.getAttribute('value'));
    return value || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '');
  }
  if (tag === 'input' && type === 'image') {
    return (
      normalizeText(el.getAttribute('alt')) || normalizeText(el.getAttribute('title')) || 'Submit'
    );
  }
  if (isFormControl(el)) {
    const label = labelText(el);
    if (label) return label;
    return normalizeText(el.getAttribute('title')) || normalizeText(el.getAttribute('placeholder'));
  }
  if (tag === 'img' || tag === 'area') {
    return normalizeText(el.getAttribute('alt')) || normalizeText(el.getAttribute('title'));
  }
  if (tag === 'fieldset') {
    const legend = Array.from(el.children).find((c) => tagOf(c) === 'legend');
    if (legend) return normalizeText(textFromContent(legend));
  }
  if (tag === 'table') {
    const caption = Array.from(el.children).find((c) => tagOf(c) === 'caption');
    if (caption) return normalizeText(textFromContent(caption));
  }
  const role = getRole(el);
  if (role && NAME_FROM_CONTENT.has(role)) {
    const text = normalizeText(textFromContent(el));
    if (text) return text;
  }
  return normalizeText(el.getAttribute('title'));
}

/** The element's own visible text, collapsed. */
export function visibleText(el: Element): string {
  return normalizeText(textFromContent(el));
}
