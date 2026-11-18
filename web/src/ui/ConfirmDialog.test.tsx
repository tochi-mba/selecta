import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, CONFIRM_COPY } from './ConfirmDialog';
import { clearToasts, Toaster } from './toasts';

afterEach(() => clearToasts());

function Harness(props: { onConfirm: () => unknown; undo?: () => void; destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Remove song</button>
      {open && <ConfirmDialog title="Remove this song?" body="It leaves this mix." destructive={props.destructive} onConfirm={props.onConfirm} undo={props.undo} onClose={() => setOpen(false)} />}
      <Toaster />
    </>
  );
}

describe('asking before doing something that matters', () => {
  it('asks on the overlay stack with the safe answer focused, and gives focus back', () => {
    render(<Harness destructive onConfirm={() => {}} />);
    const opener = screen.getByRole('button', { name: 'Remove song' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('alertdialog', { name: 'Remove this song?' });
    expect(dialog).toHaveAccessibleDescription(/It leaves this mix\..*can’t be undone\./);
    expect(document.activeElement).toHaveTextContent(CONFIRM_COPY.cancel);
    expect(dialog.closest('.overlay')).toHaveClass('confirm-dialog');
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_COPY.cancel }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('confirms, closes and offers the Undo toast when it can be taken back', async () => {
    const onConfirm = vi.fn();
    const undo = vi.fn();
    render(<Harness destructive onConfirm={onConfirm} undo={undo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove song' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(CONFIRM_COPY.undoHint);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CONFIRM_COPY.confirm })); });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(CONFIRM_COPY.undoToast);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('stays open and says what went wrong when it fails', async () => {
    render(<Harness destructive onConfirm={async () => { throw new Error('The server said no.'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove song' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CONFIRM_COPY.confirm })); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The server said no.');
  });

  it('focuses the confirm button when nothing is destroyed', () => {
    render(<Harness onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove song' }));
    expect(document.activeElement).toHaveTextContent(CONFIRM_COPY.confirm);
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(CONFIRM_COPY.permanent);
  });
});
