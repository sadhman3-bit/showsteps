import type { ComponentChildren } from 'preact';
import { RipplePattern } from '../patterns/Patterns.js';

/** A pattern band, a title, one sentence and a primary action. */
export function EmptyState(props: { title: string; text: string; children?: ComponentChildren }) {
  return (
    <section class="ss-emptystate">
      <div class="ss-emptystate__band">
        <RipplePattern />
      </div>
      <div class="ss-emptystate__body">
        <h2>{props.title}</h2>
        <p>{props.text}</p>
        {props.children}
      </div>
    </section>
  );
}
