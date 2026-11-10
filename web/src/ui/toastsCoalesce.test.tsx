import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, dismissToast, setToastsQuiet, showProblem, showToast, Toaster } from './toasts';
import { activityEntries } from '../state/activity';

/** MP-0297-06: background chatter coalesces quietly; Undo and critical failures are never swallowed. */
afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

const shown = () => [...document.body.querySelectorAll('.toast-row')].map((row) => row.textContent ?? '');

describe('repetitive notices', () => {
  it('a routine update repeated by every poll shows once, even after it is dismissed, and is logged once', () => {
    render(<Toaster />);
    let first = 0;
    act(() => { first = showToast('Library checked.'); });
    act(() => dismissToast(first));
    act(() => {
      for (let poll = 0; poll < 5; poll += 1) showToast('Library checked.');
    });
    expect(shown()).toEqual([]);
    expect(activityEntries().filter((entry) => entry.message === 'Library checked.')).toHaveLength(1);
  });

  it('the same routine update speaks again once the quiet window has passed', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    let first = 0;
    act(() => { first = showToast('Library checked.'); });
    act(() => dismissToast(first));
    act(() => { vi.setSystemTime(Date.now() + 31_000); showToast('Library checked.'); });
    expect(shown().filter((text) => text.includes('Library checked.'))).toHaveLength(1);
  });

  it('a critical failure that happens again after dismissal is shown again', () => {
    render(<Toaster />);
    let first = 0;
    act(() => { first = showProblem('Couldn’t save the mix.'); });
    act(() => dismissToast(first));
    act(() => { showProblem('Couldn’t save the mix.'); });
    expect(shown().filter((text) => text.includes('Couldn’t save the mix.'))).toHaveLength(1);
    expect(document.body.querySelector('.toast-row.problem')?.getAttribute('role')).toBe('alert');
  });

  it('two identical changes with Undo are never merged, so each can be undone', () => {
    render(<Toaster />);
    act(() => {
      showToast('Moved a song.', { undo: () => {} });
      showToast('Moved a song.', { undo: () => {} });
    });
    expect(shown().filter((text) => text.includes('Moved a song.'))).toHaveLength(2);
    expect(activityEntries().filter((entry) => entry.message === 'Moved a song.')).toHaveLength(2);
  });

  it('while quiet, routine chatter waits in Activity and a problem still interrupts', () => {
    render(<Toaster />);
    act(() => {
      setToastsQuiet(true);
      showToast('Rendered 3 transitions.');
      showProblem('A song is missing.');
    });
    expect(shown().some((text) => text.includes('Rendered 3 transitions.'))).toBe(false);
    expect(shown().some((text) => text.includes('A song is missing.'))).toBe(true);
    expect(activityEntries().some((entry) => entry.message === 'Rendered 3 transitions.')).toBe(true);
  });
});
