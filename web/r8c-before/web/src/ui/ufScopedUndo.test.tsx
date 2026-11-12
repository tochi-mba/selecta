import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activityEntries, canUndo, runUndo } from '../state/activity';
import { clearToasts, showProblem, showToast, Toaster } from './toasts';

/** UF-0370-07: an Undo outlives a burst of notifications and a change of page. The notification can
 * make room, but its Undo stays in Activity, still bound to exactly the change it was made for. */

beforeEach(() => clearToasts());

describe('scoped Undo survives bursts and navigation', () => {
  it('a burst of news and problems never loses the Undo, and it still undoes the right change', async () => {
    const undoMove = vi.fn();
    const undoDraft = vi.fn();
    render(<Toaster />);
    act(() => {
      showToast('Moved a song.', { scope: 'current', undo: undoMove });
      showToast('Renamed the draft.', { scope: 'draft:7', undo: undoDraft });
      for (const word of ['Analysed song 1.', 'Analysed song 2.', 'Analysed song 3.', 'Analysed song 4.']) showToast(word);
      showProblem('Couldn’t reach the server.');
      showProblem('Couldn’t save that change.');
    });
    const entries = activityEntries();
    const move = entries.find((entry) => entry.message === 'Moved a song.');
    const rename = entries.find((entry) => entry.message === 'Renamed the draft.');
    expect(move && canUndo(move.id)).toBe(true);
    expect(rename && canUndo(rename.id)).toBe(true);
    await act(async () => runUndo(move!.id));
    expect(undoMove).toHaveBeenCalledTimes(1);
    expect(undoDraft).not.toHaveBeenCalled();
  });

  it('leaving a page and coming back keeps the Undo on screen', () => {
    const undo = vi.fn();
    const first = render(<Toaster />);
    act(() => { showToast('Moved a song.', { scope: 'current', undo }); });
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument();
    // a route change remounts the page; the notifications live outside any one page
    first.unmount();
    render(<Toaster />);
    expect(screen.getByText('Moved a song.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument();
  });
});
