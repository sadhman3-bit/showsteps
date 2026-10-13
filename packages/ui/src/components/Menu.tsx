import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton } from '../Button.js';
import type { IconName } from './iconPaths.js';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}

/** A "⋯" button with a list of actions. Esc or a click outside closes it. */
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
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('.ss-iconbtn')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
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
              role="menuitem"
              class={item.danger ? 'is-danger' : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
