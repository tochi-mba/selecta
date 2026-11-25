import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { Moment, MOMENT_GAP_MS } from './moment';

/** FL-0477-06: a celebration is rare by construction. One at a time, one per eight seconds, only
 * on Expressive with the moments part on, and the caller is never kept waiting when it is refused. */

/** A start time far past every earlier test's, so the module's budget never carries over. */
let base = 10_000_000;

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  vi.useFakeTimers();
  base += 1_000_000;
  vi.setSystemTime(base);
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FL-0477-06 Moment', () => {
  it('plays once as decoration, then goes and calls onDone', () => {
    const done = vi.fn();
    const { container } = render(<Moment kind="equalizer" onDone={done} />);
    const burst = container.querySelector('.feel-moment');
    expect(burst).not.toBeNull();
    expect(burst).toHaveAttribute('aria-hidden', 'true');
    expect(done).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(done).toHaveBeenCalledOnce();
    expect(container.querySelector('.feel-moment')).toBeNull();
  });

  it('refuses a second one while one runs, and calls its onDone at once', () => {
    render(<Moment kind="equalizer" />);
    const second = vi.fn();
    const { container } = render(<Moment kind="blend" onDone={second} />);
    expect(second).toHaveBeenCalledOnce();
    expect(container.querySelector('.feel-moment')).toBeNull();
  });

  it('allows one per eight seconds', () => {
    const first = render(<Moment kind="equalizer" />);
    act(() => { vi.advanceTimersByTime(2000); });
    first.unmount();
    const early = vi.fn();
    const refused = render(<Moment kind="equalizer" onDone={early} />);
    expect(early).toHaveBeenCalledOnce();
    expect(refused.container.querySelector('.feel-moment')).toBeNull();
    refused.unmount();
    act(() => { vi.advanceTimersByTime(MOMENT_GAP_MS); });
    const later = render(<Moment kind="blend" />);
    expect(later.container.querySelector('.feel-moment')).not.toBeNull();
  });

  it('is refused outside Expressive, with onDone called at once', () => {
    setPrefs({ motion: 'subtle' });
    const done = vi.fn();
    const { container } = render(<Moment kind="equalizer" onDone={done} />);
    expect(done).toHaveBeenCalledOnce();
    expect(container.querySelector('.feel-moment')).toBeNull();
  });

  it('taken away before it finishes, it does not spend the budget', () => {
    const done = vi.fn();
    const first = render(<Moment kind="equalizer" onDone={done} />);
    first.unmount();
    expect(done).not.toHaveBeenCalled();
    const again = render(<Moment kind="equalizer" />);
    expect(again.container.querySelector('.feel-moment')).not.toBeNull();
  });
});
