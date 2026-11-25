import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activityEntries, canUndo, runUndo, UNDO_LIMIT_MS } from '../state/activity';
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

describe('an Undo that never answers (T-20261125-f1eb)', () => {
  it('counts as failed after the limit, keeps older Undos blocked, and a late success marks it undone', async () => {
    vi.useFakeTimers();
    try {
      let answer: (value?: unknown) => void = () => undefined;
      showToast('Moved one song.', { scope: 'mix:9', undo: vi.fn() });
      showToast('Moved another song.', { scope: 'mix:9', undo: () => new Promise((resolve) => { answer = resolve; }) });
      const [newer, older] = activityEntries().filter((entry) => entry.scope === 'mix:9');
      const running = runUndo(newer.id).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(UNDO_LIMIT_MS + 10);
      expect(String(await running)).toMatch(/couldn’t confirm this Undo/);
      expect(activityEntries().find((entry) => entry.id === newer.id)?.undoState).toBe('failed');
      expect(canUndo(older.id)).toBe(false);
      answer();
      await vi.advanceTimersByTimeAsync(0);
      expect(activityEntries().find((entry) => entry.id === newer.id)?.undoState).toBe('undone');
    } finally {
      vi.useRealTimers();
    }
  });
});
