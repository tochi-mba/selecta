import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisiblePoll } from './useVisiblePoll';

function Poller({ tick, backoff }: { tick: () => Promise<unknown>; backoff: boolean }) {
  useVisiblePoll(tick, 1000, true, { backoff, maxMs: 8000 });
  return null;
}

afterEach(() => { vi.useRealTimers(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('r8c polling backs off while reads fail', () => {
  it('waits 2, 4 then 8 intervals after failures, and returns to every interval after a good read', async () => {
    vi.useFakeTimers();
    let failing = true;
    const tick = vi.fn(() => (failing ? Promise.reject(new Error('away')) : Promise.resolve()));
    const { unmount } = render(<Poller tick={tick} backoff />);
    const at: number[] = [];
    for (let second = 1; second <= 20; second += 1) {
      const before = tick.mock.calls.length;
      act(() => { vi.advanceTimersByTime(1000); });
      await flush();
      if (tick.mock.calls.length > before) at.push(second);
    }
    // a read at 1 s fails, then the gaps grow: 2 s, 4 s, then capped at 8 s
    expect(at).toEqual([1, 3, 7, 15]);
    failing = false;
    const before = tick.mock.calls.length;
    for (let second = 0; second < 8; second += 1) {
      act(() => { vi.advanceTimersByTime(1000); });
      await flush();
    }
    // the next read (at 23 s) succeeds, and from then on it reads every second again
    const after = tick.mock.calls.length - before;
    expect(after).toBeGreaterThanOrEqual(5);
    unmount();
    console.info(`[r8c] poll, 20 s with the server away: ${at.length} reads (was 20 without backoff)`);
  });

  it('without backoff keeps its old pace', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(() => Promise.reject(new Error('away')));
    const { unmount } = render(<Poller tick={tick} backoff={false} />);
    for (let second = 1; second <= 5; second += 1) {
      act(() => { vi.advanceTimersByTime(1000); });
      await flush();
    }
    expect(tick).toHaveBeenCalledTimes(5);
    unmount();
  });
});
