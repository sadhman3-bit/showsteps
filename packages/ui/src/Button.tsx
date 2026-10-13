import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { Icon, type IconName } from './components/Icon.js';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'size'> & {
  /**
   * primary: accent fill. default (secondary): outlined. ghost: no border. danger: alert outline.
   * signal: pink fill, only for Finish and Record in controls drawn over other apps.
   */
  variant?: 'primary' | 'default' | 'danger' | 'ghost' | 'signal';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  children: ComponentChildren;
};

export function Button({
  variant = 'default',
  size = 'md',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      class={`ss-button${rest.class ? ` ${String(rest.class)}` : ''}`}
      data-variant={variant}
      data-size={size === 'md' ? undefined : size}
    >
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'size' | 'children'
> & {
  icon: IconName;
  /** Accessible name; also shown as a tooltip. */
  label: string;
  size?: 'sm' | 'md';
};

/** A labelled icon-only button (32–36px, tooltip on hover and focus). */
export function IconButton({ icon, label, size = 'md', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      class={`ss-iconbtn${rest.class ? ` ${String(rest.class)}` : ''}`}
      aria-label={label}
      data-tip={label}
      data-size={size === 'sm' ? 'sm' : undefined}
    >
      <Icon name={icon} size={size === 'sm' ? 18 : 20} />
    </button>
  );
}
