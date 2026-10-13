import {
  normalizeRichText as normalize,
  toHtml,
  toPlainText,
  type RichText,
  type Span,
} from '@showsteps/core';
import DOMPurify from 'dompurify';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PromptDialog } from '../components/Dialog.js';
import { strings } from '../strings.js';

const e = strings.editor;
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Rich text → sanitised HTML for the editable element. */
function renderHtml(value: RichText): string {
  const html = toHtml(value).replace(/\n/g, '<br>');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'a', 'br'],
    ALLOWED_ATTR: ['href'],
  });
}

/** Read the editable element back into rich text. */
export function parseRichText(root: Node): RichText {
  const spans: Span[] = [];
  const walk = (node: Node, fmt: Omit<Span, 'text'>, first: boolean) => {
    if (node.nodeType === 3) {
      if (node.textContent) spans.push({ text: node.textContent, ...fmt });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName;
    if (tag === 'br') {
      spans.push({ text: '\n', ...fmt });
      return;
    }
    if ((tag === 'div' || tag === 'p') && !first) spans.push({ text: '\n', ...fmt });
    const next = { ...fmt };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (SAFE_LINK.test(href)) next.href = href;
    }
    Array.from(el.childNodes).forEach((c, i) => walk(c, next, first && i === 0));
  };
  Array.from(root.childNodes).forEach((c, i) => walk(c, {}, i === 0));
  // Trailing line breaks are an artefact of contenteditable.
  const out = normalize({ spans });
  const last = out.spans[out.spans.length - 1];
  if (last) last.text = last.text.replace(/\n+$/, '');
  return normalize(out);
}

const same = (a: RichText, b: RichText) => JSON.stringify(a.spans) === JSON.stringify(b.spans);

export interface RichTextFieldProps {
  value: RichText;
  onChange: (value: RichText) => void;
  /** Called when the field loses focus after a change (an undo point). */
  onCommit?: () => void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  class?: string;
}

/** Inline rich-text editor: bold, italic and links; pastes plain text only. */
export function RichTextField({
  value,
  onChange,
  onCommit,
  label,
  placeholder,
  multiline,
  class: cls,
}: RichTextFieldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<RichText>(value);
  const savedRange = useRef<Range | null>(null);
  const [asking, setAsking] = useState(false);
  const [empty, setEmpty] = useState(!toPlainText(value));

  // Only overwrite the DOM when the value changed from outside (undo, restore), never while typing.
  useEffect(() => {
    const el = ref.current;
    if (!el || same(value, last.current)) return;
    // While the user is typing, their text is the truth: a render can lag a keystroke behind,
    // and rewriting the element would throw the caret to the start.
    if (el.ownerDocument.activeElement === el) return;
    last.current = value;
    el.innerHTML = renderHtml(value);
    setEmpty(!toPlainText(value));
  }, [value]);

  // First render: fill the element once; afterwards the user's typing owns it.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = renderHtml(last.current);
  }, []);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const next = parseRichText(el);
    setEmpty(!toPlainText(next));
    if (same(next, last.current)) return;
    last.current = next;
    onChange(next);
  };

  const format = (command: 'bold' | 'italic') => {
    ref.current?.focus();
    document.execCommand(command);
    emit();
  };

  const askLink = () => {
    const sel = getSelection();
    savedRange.current =
      sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)
        ? sel.getRangeAt(0).cloneRange()
        : null;
    setAsking(true);
  };

  const applyLink = (url: string) => {
    setAsking(false);
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    if (!url) document.execCommand('unlink');
    else if (SAFE_LINK.test(url)) document.execCommand('createLink', false, url);
    emit();
    onCommit?.();
  };

  return (
    <div class={`ss-rich ${cls ?? ''}`}>
      <div
        ref={ref}
        class={`ss-rich__input${multiline ? ' ss-rich__input--multi' : ''}`}
        contentEditable
        role="textbox"
        aria-label={label}
        aria-multiline={multiline ? 'true' : 'false'}
        data-placeholder={placeholder}
        data-empty={empty ? 'true' : 'false'}
        onInput={emit}
        onBlur={() => onCommit?.()}
        onKeyDown={(ev) => {
          const mod = ev.ctrlKey || ev.metaKey;
          if (mod && (ev.key === 'b' || ev.key === 'B')) {
            ev.preventDefault();
            format('bold');
          } else if (mod && (ev.key === 'i' || ev.key === 'I')) {
            ev.preventDefault();
            format('italic');
          } else if (mod && (ev.key === 'k' || ev.key === 'K')) {
            ev.preventDefault();
            askLink();
          } else if (ev.key === 'Enter' && !mod && !ev.shiftKey) {
            ev.preventDefault();
            if (multiline) {
              document.execCommand('insertLineBreak');
              emit();
            }
          }
        }}
        onPaste={(ev) => {
          const text = ev.clipboardData?.getData('text/plain');
          if (text) {
            ev.preventDefault();
            ev.stopPropagation();
            document.execCommand(
              'insertText',
              false,
              multiline ? text : text.replace(/\s*\n\s*/g, ' '),
            );
            emit();
          } else {
            // Images bubble up to the editor, which turns them into a new step.
            ev.preventDefault();
          }
        }}
      />
      <div class="ss-rich__tools" role="toolbar" aria-label={label}>
        <button
          type="button"
          aria-label={e.bold}
          title={e.bold}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => format('bold')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label={e.italic}
          title={e.italic}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => format('italic')}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label={e.link}
          title={e.link}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={askLink}
        >
          ⛓
        </button>
      </div>
      {asking ? (
        <PromptDialog
          title={e.link}
          label={e.linkUrl}
          hint={e.removeLink}
          initial="https://"
          onClose={() => setAsking(false)}
          onSubmit={(url) => applyLink(url === 'https://' ? '' : url)}
        />
      ) : null}
    </div>
  );
}
