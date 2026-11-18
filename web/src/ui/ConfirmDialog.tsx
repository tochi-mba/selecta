import { ReactNode, useId } from 'react';
import { Action, Dialog } from './controls';
import { showToast } from './toasts';

/** "Are you sure?" asked the SelectaDJ way, on the shared overlay stack: focus goes in, stays in and
 * comes back to whatever opened it, and the page underneath is inert, unlike `window.confirm`.
 *
 * A destructive choice is honest about what happens next. When it can be taken back (`undo`), the
 * question says so and confirming shows the 15 second Undo toast, which Activity keeps after the
 * toast has gone. When it can't, the dialog says plainly that it can't, and the safe answer has
 * focus, so Enter on its own never destroys anything. */
export const CONFIRM_COPY = {
  confirm: 'Yes, remove it',
  cancel: 'Keep it',
  working: 'Removing…',
  undoToast: 'Removed. You can undo this for a few seconds.',
  undoHint: 'You can undo this for a few seconds afterwards.',
  permanent: 'This can’t be undone.',
} as const;

export type ConfirmDialogProps = {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** does the thing; if it throws, the dialog stays open and the problem is shown */
  onConfirm: () => Promise<unknown> | unknown;
  /** closes the dialog; called after a successful confirm as well as on cancel */
  onClose: () => void;
  /** takes the thing back; makes a destructive confirm show the Undo toast */
  undo?: () => Promise<unknown> | void;
  /** the Undo toast's words, default "Removed. You can undo this for a few seconds." */
  undoMessage?: string;
  /** the busy label on the confirm button while `onConfirm` runs */
  working?: ReactNode;
  /** what the problem toast says when `onConfirm` fails, if its error has no message of its own */
  failed?: string;
};

export function ConfirmDialog({
  title,
  body,
  confirmLabel = CONFIRM_COPY.confirm,
  cancelLabel = CONFIRM_COPY.cancel,
  destructive = false,
  onConfirm,
  onClose,
  undo,
  undoMessage = CONFIRM_COPY.undoToast,
  working = destructive ? CONFIRM_COPY.working : undefined,
  failed,
}: ConfirmDialogProps) {
  const bodyId = useId();
  const confirm = async () => {
    await onConfirm();
    onClose();
    if (undo) showToast(undoMessage, { undo });
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      className="confirm-dialog"
      role="alertdialog"
      describedBy={bodyId}
      footer={(
        <>
          <button type="button" onClick={onClose} data-autofocus={destructive ? true : undefined}>{cancelLabel}</button>
          <Action
            type="button"
            className={destructive ? 'destructive' : 'primary'}
            run={confirm}
            working={working}
            failed={failed}
            data-autofocus={destructive ? undefined : true}
          >{confirmLabel}</Action>
        </>
      )}
    >
      <div id={bodyId} className="confirm-dialog-body">
        {typeof body === 'string' ? <p>{body}</p> : body}
        {destructive && <p className="hint confirm-dialog-consequence">{undo ? CONFIRM_COPY.undoHint : CONFIRM_COPY.permanent}</p>}
      </div>
    </Dialog>
  );
}
