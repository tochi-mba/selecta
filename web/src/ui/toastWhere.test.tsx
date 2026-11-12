import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearToasts, showToast, Toaster } from './toasts';

/** UF-0380-07: an edit's toast names the mix it changed, so Undo's reach is clear without opening Activity. */

beforeEach(() => clearToasts());

describe('undo and save provenance on the toast', () => {
  it('names the mix that changed next to the message and its Undo', () => {
    render(<Toaster />);
    act(() => {
      showToast('Added Paper Moon.', { scope: 'draft:4', undo: () => undefined, where: 'Friday night' });
    });
    const row = screen.getByText('Added Paper Moon.').closest('.toast-row') as HTMLElement;
    expect(row).toHaveTextContent('Added Paper Moon.In Friday night.');
    expect(row.querySelector('.toast-where')).toHaveTextContent('In Friday night.');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('says nothing extra when no mix is involved', () => {
    render(<Toaster />);
    act(() => { showToast('Transitions are ready.'); });
    expect(document.body.querySelector('.toast-where')).toBeNull();
  });
});
