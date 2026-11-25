import { afterEach, describe, expect, it, vi } from 'vitest';
import { askReadAccess, withTimeout } from './withTimeout';

// A browser promise that never settles (a swallowed permission prompt) must not leave a button
// busy for ever: no answer becomes an ordinary answer the caller already handles.

afterEach(() => { vi.useRealTimers(); });

describe('withTimeout', () => {
  it('passes the answer on when it comes in time', async () => {
    await expect(withTimeout(Promise.resolve('granted'), 1_000, 'unanswered')).resolves.toBe('granted');
  });

  it('gives the fallback when no answer comes', async () => {
    vi.useFakeTimers();
    const waiting = withTimeout(new Promise<string>(() => {}), 1_000, 'unanswered');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toBe('unanswered');
  });

  it('passes a refusal on as it came', async () => {
    await expect(withTimeout(Promise.reject(new Error('no')), 1_000, 'x')).rejects.toThrow('no');
  });
});

describe('askReadAccess', () => {
  it('a swallowed prompt counts as unanswered, so the press can be offered again', async () => {
    vi.useFakeTimers();
    const asking = askReadAccess({ requestPermission: () => new Promise<string>(() => {}) }, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(asking).resolves.toBe('unanswered');
  });

  it('a refused request is denied, and a handle with no permission API is granted', async () => {
    await expect(askReadAccess({ requestPermission: () => Promise.reject(new Error('blocked')) })).resolves.toBe('denied');
    await expect(askReadAccess({})).resolves.toBe('granted');
  });
});
