import { useState } from 'preact/hooks';

export interface TextFieldProps {
  value: string;
  onValue: (value: string) => void;
  /** Called when the field loses focus (ends a run of typing). */
  onDone?: () => void;
  multiline?: boolean;
  class?: string;
  'aria-label': string;
  placeholder?: string;
  rows?: number;
}

/**
 * Plain text input that keeps its own value while focused, so a render that lags a keystroke
 * behind can never reset what the user is typing. Shows the prop value otherwise.
 */
export function TextField({ value, onValue, onDone, multiline, ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const props = {
    ...rest,
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onInput: (e: Event) => {
      const v = (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
      setDraft(v);
      onValue(v);
    },
    onBlur: () => {
      setDraft(null);
      onDone?.();
    },
  };
  return multiline ? <textarea {...props} /> : <input {...props} />;
}
