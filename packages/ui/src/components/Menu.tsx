import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton } from '../Button.js';
import { Icon } from './Icon.js';
import type { IconName } from './iconPaths.js';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  /** A toggle: shown with a check mark when on. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Why an item is disabled (shown under it). */
  hint?: string;
}

/**
 * A "⋯" button with a list of actions. Esc or a click outside closes it; arrow keys move
 * between items.
 */
export function Menu(props: {
  label: string;
  items: MenuItem[];
  icon?: IconName;
  children?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('.ss-iconbtn')?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keys, true);
    items()[0]?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keys, true);
    };
  }, [open]);
  return (
    <div class="ss-popmenu" ref={ref}>
      <IconButton
        icon={props.icon ?? 'more'}
        label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open ? (
        <div class="ss-popmenu__list" role="menu" aria-label={props.label}>
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              class={item.danger ? 'is-danger' : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.checked !== undefined ? (
                <span class="ss-popmenu__check">
                  {item.checked ? <Icon name="check" size={16} /> : null}
                </span>
              ) : item.icon ? (
                <Icon name={item.icon} size={16} />
              ) : null}
              {item.hint ? (
                <span class="ss-popmenu__text">
                  {item.label}
                  <small>{item.hint}</small>
                </span>
              ) : (
                item.label
              )}
            </button>
          ))}
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
