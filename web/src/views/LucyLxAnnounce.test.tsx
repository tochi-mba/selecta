import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Announcer, useAnnouncer } from './LucyTranscript';

/* LX-0356-07: Lucy's live region speaks milestones at a calm pace. The words themselves come from
 * summarize() in src/lucy/reducer.ts (tested in reducer.test.ts, "say what happened once, never word
 * by word"); this proves the pacing. The transcript log itself is aria-live="off" (LucyTranscript.tsx). */
afterEach(() => vi.useRealTimers());

describe('LX-0356-07 announcements', () => {
  it('collects a burst into one sentence, says nothing twice and waits two seconds before speaking again', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnnouncer());
    act(() => {
      for (let n = 0; n < 30; n += 1) result.current.say(['Lucy is replying']);
      result.current.say(['2 steps finished']);
    });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.words).toBe('Lucy is replying. 2 steps finished.');
    act(() => { result.current.say(['New proposal: revision 3']); });
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.words).toBe('Lucy is replying. 2 steps finished.');
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.words).toBe('New proposal: revision 3.');
  });

  it('the announcer is one polite atomic status region', () => {
    const { container } = render(<Announcer words="Lucy is replying." />);
    const region = container.querySelector('[role="status"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });
});
