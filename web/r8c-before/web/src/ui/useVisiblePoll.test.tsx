import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisiblePoll } from './useVisiblePoll';

function Observer({ tick, interval = 1000 }: { tick: () => void; interval?: number }) {
  useVisiblePoll(tick, interval);
  return null;
}

afterEach(() => { vi.useRealTimers(); });

describe('visibility-aware presentation refresh', () => {
  it('does not poll hidden tabs, refreshes on return, and removes its listeners', () => {
    vi.useFakeTimers();
    let hidden = false;
    const state = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => hidden ? 'hidden' : 'visible',
    );
    const tick = vi.fn();
    try {
      const { unmount } = render(<Observer tick={tick} />);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(tick).toHaveBeenCalledTimes(1);

      hidden = true;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(3000);
      });
      expect(tick).toHaveBeenCalledTimes(1);

      hidden = false;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(tick).toHaveBeenCalledTimes(2);
      unmount();
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(3000);
      });
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      state.mockRestore();
    }
  });
});


describe('slow visibility-aware refreshes', () => {
  it('never overlaps reads and catches up once after returning to a visible tab', async () => {
    vi.useFakeTimers();
    let hidden = false;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => hidden ? 'hidden' : 'visible',
    );
    const finish: Array<() => void> = [];
    const tick = vi.fn(() => new Promise<void>((resolve) => { finish.push(resolve); }));
    try {
      const { unmount } = render(<Observer tick={tick} />);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(tick).toHaveBeenCalledTimes(1);

      hidden = true;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      hidden = false;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(tick).toHaveBeenCalledTimes(1);

      await act(async () => { finish[0](); await Promise.resolve(); });
      expect(tick).toHaveBeenCalledTimes(2);

      act(() => { vi.advanceTimersByTime(3000); });
      expect(tick).toHaveBeenCalledTimes(2);
      unmount();
      await act(async () => { finish[1](); await Promise.resolve(); });
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it('releases the polling slot after a failed read', async () => {
    vi.useFakeTimers();
    const finish: Array<(reason?: Error) => void> = [];
    const tick = vi.fn(() => new Promise<void>((_resolve, reject) => {
      finish.push(reject);
    }));
    const { unmount } = render(<Observer tick={tick} />);
    try {
      act(() => { vi.advanceTimersByTime(1000); });
      expect(tick).toHaveBeenCalledTimes(1);
      await act(async () => { finish[0](new Error('offline')); await Promise.resolve(); });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
    }
  });
});
