import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { strings } from '../strings.js';
import { Button } from '../Button.js';

export interface DialogProps {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  /** Footer buttons; a Close button is shown when omitted. */
  actions?: ComponentChildren;
}

/** Modal built on <dialog>: focus trapping, Esc to close and the backdrop come from the browser. */
export function Dialog({ title, children, onClose, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Unique per dialog: dialogs can be nested (a confirmation inside version history).
  const titleId = `tm-dialog-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      class="tm-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div class="tm-dialog__body">{children}</div>
      <div class="tm-dialog__actions">
        {actions ?? <Button onClick={onClose}>{strings.library.close}</Button>}
      </div>
    </dialog>
  );
}

/** Ask for a line of text (rename, new folder, tags). */
export function PromptDialog(props: {
  title: string;
  label: string;
  initial?: string;
  hint?: string;
  confirm?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  const submit = (e: Event) => {
    e.preventDefault();
    const value = input.current?.value.trim() ?? '';
    if (value || props.hint) props.onSubmit(value);
  };
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{strings.library.cancel}</Button>
          <Button variant="primary" type="submit" form="tm-prompt">
            {props.confirm ?? strings.library.save}
          </Button>
        </>
      }
    >
      <form id="tm-prompt" class="tm-field" onSubmit={submit}>
        <label for="tm-prompt-input">{props.label}</label>
        <input id="tm-prompt-input" ref={input} class="tm-input" value={props.initial ?? ''} />
        {props.hint ? <small class="tm-muted">{props.hint}</small> : null}
      </form>
    </Dialog>
  );
}

/** Yes/no confirmation for destructive actions. */
export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{strings.library.cancel}</Button>
          <Button variant="danger" onClick={props.onConfirm}>
            {props.confirm}
          </Button>
        </>
      }
    >
      <p>{props.message}</p>
    </Dialog>
  );
}
