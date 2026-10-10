import type { InputMode } from '@trailmark/core';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { InputModeSelect } from '../components/InputModeSelect.js';
import { strings } from '../strings.js';

const s = strings.settings;

export interface UserSettings {
  userName: string;
  guidanceEnabled: boolean;
  aiEnabled: boolean;
  /** Extension only: connect to the desktop app. */
  desktopApp?: boolean;
  /** How typed values in new guides are used (U4). */
  defaultInputMode?: InputMode;
  theme?: Theme;
  liveBlurDefault?: boolean;
  magnify?: 1 | 1.5 | 2 | 3;
  screenshotQuality?: 'high' | 'standard';
}

export type Theme = 'system' | 'light' | 'dark';

/** Show Trailmark's pages in light, dark or the system's colours. */
export function applyTheme(theme: Theme | undefined): void {
  if (!theme || theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Settings shared by the extension and the desktop app (grows with later milestones). */
export function SettingsDialog<T extends UserSettings>({
  value,
  aiAvailable,
  desktop,
  extra,
  onSave,
  onClose,
}: {
  value: T;
  aiAvailable: boolean;
  /** Offer the desktop app connection, with its current status. */
  desktop?: { connected: boolean };
  /** Host-specific controls at the end (shortcuts, delete all data). */
  extra?: ComponentChildren;
  onSave: (value: T) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const submit = (e: Event) => {
    e.preventDefault();
    onSave({ ...draft, userName: draft.userName.trim() || value.userName });
  };
  return (
    <Dialog
      title={s.title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{strings.library.cancel}</Button>
          <Button variant="primary" type="submit" form="tm-settings">
            {s.save}
          </Button>
        </>
      }
    >
      <form id="tm-settings" class="tm-stack-form" onSubmit={submit}>
        <label class="tm-field">
          {s.userName}
          <input
            class="tm-input"
            value={draft.userName}
            maxLength={100}
            onInput={(e) => setDraft({ ...draft, userName: e.currentTarget.value })}
          />
          <small class="tm-muted">{s.userNameHint}</small>
        </label>
        <label class="tm-check">
          <input
            type="checkbox"
            checked={draft.guidanceEnabled}
            onChange={(e) => setDraft({ ...draft, guidanceEnabled: e.currentTarget.checked })}
          />{' '}
          {s.guidance}
        </label>
        {draft.theme ? (
          <label class="tm-field">
            {s.theme}
            <select
              class="tm-input"
              value={draft.theme}
              onChange={(e) => setDraft({ ...draft, theme: e.currentTarget.value as Theme })}
            >
              {(['system', 'light', 'dark'] as const).map((t) => (
                <option key={t} value={t}>
                  {s.themes[t]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {draft.magnify !== undefined ? (
          <fieldset class="tm-fieldset">
            <legend>{s.captureHeading}</legend>
            <label class="tm-check">
              <input
                type="checkbox"
                checked={!!draft.liveBlurDefault}
                onChange={(e) => setDraft({ ...draft, liveBlurDefault: e.currentTarget.checked })}
              />{' '}
              {s.liveBlurDefault}
            </label>
            <label class="tm-field">
              {s.magnify}
              <select
                class="tm-input"
                value={String(draft.magnify)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    magnify: Number(e.currentTarget.value) as 1 | 1.5 | 2 | 3,
                  })
                }
              >
                {[1, 1.5, 2, 3].map((z) => (
                  <option key={z} value={String(z)}>
                    {s.magnifyLevels[String(z)]}
                  </option>
                ))}
              </select>
            </label>
            <label class="tm-field">
              {s.quality}
              <select
                class="tm-input"
                value={draft.screenshotQuality ?? 'high'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    screenshotQuality: e.currentTarget.value as 'high' | 'standard',
                  })
                }
              >
                {(['high', 'standard'] as const).map((q) => (
                  <option key={q} value={q}>
                    {s.qualities[q]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ) : null}
        {draft.defaultInputMode ? (
          <label class="tm-field">
            {s.inputMode}
            <InputModeSelect
              value={draft.defaultInputMode}
              onChange={(mode) => setDraft({ ...draft, defaultInputMode: mode })}
            />
            <small class="tm-muted">{s.inputModeHint}</small>
          </label>
        ) : null}
        {desktop ? (
          <label class="tm-check">
            <input
              type="checkbox"
              checked={!!draft.desktopApp}
              onChange={(e) => setDraft({ ...draft, desktopApp: e.currentTarget.checked })}
            />{' '}
            {s.desktopApp}
            <small class="tm-muted tm-block-text">
              {s.desktopAppHint}{' '}
              {value.desktopApp
                ? desktop.connected
                  ? s.desktopConnected
                  : s.desktopOffline
                : null}
            </small>
          </label>
        ) : null}
        {aiAvailable ? (
          <label class="tm-check">
            <input
              type="checkbox"
              checked={draft.aiEnabled}
              onChange={(e) => setDraft({ ...draft, aiEnabled: e.currentTarget.checked })}
            />{' '}
            {s.ai}
            <small class="tm-muted tm-block-text">{s.aiHint}</small>
          </label>
        ) : (
          <p class="tm-muted">{s.aiUnavailable}</p>
        )}
        {extra}
      </form>
    </Dialog>
  );
}
