import type { ComponentChild } from 'preact';
import type { RichText as RichTextDoc } from '@trailmark/core';

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Render rich text as elements (never innerHTML), so guide content cannot inject markup. */
export function RichText({ value }: { value: RichTextDoc | undefined }) {
  if (!value) return null;
  return (
    <>
      {value.spans.map((s, i) => {
        let node: ComponentChild = s.text;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        if (s.href && SAFE_LINK.test(s.href)) {
          node = (
            <a href={s.href} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}
