import { useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { strings } from '../strings.js';

const s = strings.settings;

export interface UserSettings {
  userName: string;
  guidanceEnabled: boolean;
  aiEnabled: boolean;
}

/** Settings shared by the extension and the desktop app (grows with later milestones). */
export function SettingsDialog({
  value,
  aiAvailable,
  onSave,
  onClose,
}: {
  value: UserSettings;
  aiAvailable: boolean;
  onSave: (value: UserSettings) => void;
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
      </form>
    </Dialog>
  );
}
