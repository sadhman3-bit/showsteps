import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: 'primary' | 'default';
  type?: 'button' | 'submit';
  children: ComponentChildren;
};

export function Button({ variant = 'default', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} class="tm-button" data-variant={variant}>
      {children}
    </button>
  );
}
