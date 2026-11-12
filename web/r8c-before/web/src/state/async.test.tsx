import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLoaded } from './async';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('useLoaded request identity', () => {
  it('never shows the previous key after switching, even before effects finish', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }) => useLoaded(() => key === 'first' ? first.promise : second.promise, key),
      { initialProps: { key: 'first' } },
    );
    await act(async () => first.resolve('songs from first search'));
    expect(result.current).toMatchObject({ state: 'ready', data: 'songs from first search' });

    rerender({ key: 'second' });
    expect(result.current).toMatchObject({ state: 'loading', data: null });
    await act(async () => second.resolve('songs from second search'));
    expect(result.current).toMatchObject({ state: 'ready', data: 'songs from second search' });
  });

  it('ignores an old response that completes after a newer request', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }) => useLoaded(() => key === 'first' ? first.promise : second.promise, key),
      { initialProps: { key: 'first' } },
    );
    rerender({ key: 'second' });
    await act(async () => first.resolve('old'));
    expect(result.current).toMatchObject({ state: 'loading', data: null });
    await act(async () => second.resolve('new'));
    expect(result.current).toMatchObject({ state: 'ready', data: 'new' });
  });

  it('keeps the last good answer only for a failed refresh of the same key', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce('a good response')
      .mockRejectedValueOnce(new Error('connection lost'));
    const { result } = renderHook(() => useLoaded(load, 'same'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({
      state: 'stale', data: 'a good response', stale: true, message: 'connection lost',
    });
  });
});
