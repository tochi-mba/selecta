import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLoaded } from './async';

// SF-0232-07: an old success that lands late can never cover up a newer failure, for the same
// read retried or for a read that has moved on to something else.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('SF-0232-07 a late success never overwrites a newer failure', () => {
  it('a retry that fails stays failed when the slower first read then succeeds', async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const { result } = renderHook(() => useLoaded(load, 'mix'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    let retried!: Promise<void>;
    act(() => { retried = result.current.retry(); });
    await act(async () => { fast.reject(new Error('the server is not answering')); await retried; });
    expect(result.current).toMatchObject({ state: 'failed', data: null, message: 'the server is not answering' });
    await act(async () => slow.resolve('an old mix'));
    expect(result.current).toMatchObject({ state: 'failed', data: null });
  });

  it('a newer revision that failed is not replaced by the old revision arriving late', async () => {
    const old = deferred<string>();
    const current = deferred<string>();
    const { result, rerender } = renderHook(
      ({ revision }) => useLoaded(() => (revision === 1 ? old.promise : current.promise), `rev-${revision}`),
      { initialProps: { revision: 1 } },
    );
    rerender({ revision: 2 });
    await act(async () => current.reject(new Error('revision 2 could not be read')));
    expect(result.current).toMatchObject({ state: 'failed', message: 'revision 2 could not be read' });
    await act(async () => old.resolve('revision 1'));
    expect(result.current).toMatchObject({ state: 'failed', data: null });
  });
});
