import type { InputMode } from '@trailmark/core';
import { strings } from '../strings.js';

const MODES: InputMode[] = ['fixed', 'ask', 'default'];

/** Fixed text, ask every run, or ask with a default (U4). */
export function InputModeSelect(props: {
  value: InputMode;
  onChange: (mode: InputMode) => void;
  label?: string;
}) {
  return (
    <select
      class="tm-input"
      value={props.value}
      {...(props.label ? { 'aria-label': props.label } : {})}
      onChange={(e) => props.onChange(e.currentTarget.value as InputMode)}
    >
      {MODES.map((m) => (
        <option key={m} value={m}>
          {strings.inputMode[m]}
        </option>
      ))}
    </select>
  );
}
