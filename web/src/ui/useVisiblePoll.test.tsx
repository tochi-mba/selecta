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
