import { describe, expect, it, vi } from 'vitest';
import { createEngineStore } from './state';

describe('the engine store', () => {
  it('starts idle with the output unverified, because nothing has been proven', () => {
    const store = createEngineStore();
    expect(store.get()).toEqual({ phase: 'idle', output: { status: 'output_unverified' }, notice: '' });
  });

  it('tells subscribers about every change and lets them leave', () => {
    const store = createEngineStore();
    const heard = vi.fn();
    const leave = store.subscribe(heard);
    store.set({ phase: 'loading' });
    store.set({ phase: 'playing', notice: '' });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'playing' }));
    leave();
    store.set({ phase: 'paused' });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('downgrades the output on evidence and never upgrades it from a listener', () => {
    const store = createEngineStore();
    store.confirmHeard(1000);
    expect(store.get().output).toEqual({ status: 'verified_at', at: 1000 });
    store.downgradeOutput({ status: 'uncertain' }, 'The tab went away.');
    expect(store.get().output).toEqual({ status: 'uncertain' });
    expect(store.get().notice).toBe('The tab went away.');
    // A late, milder event must not make the display more confident again.
    store.downgradeOutput({ status: 'output_unverified' });
    expect(store.get().output).toEqual({ status: 'uncertain' });
    store.downgradeOutput({ status: 'interrupted' });
    expect(store.get().output).toEqual({ status: 'interrupted' });
    store.downgradeOutput({ status: 'uncertain' });
    expect(store.get().output).toEqual({ status: 'interrupted' });
  });

  it('applies a downgrade of the same rank, so a fresh reason replaces a stale one', () => {
    const store = createEngineStore();
    store.downgradeOutput({ status: 'uncertain' }, 'first');
    store.downgradeOutput({ status: 'uncertain' }, 'second');
    expect(store.get().notice).toBe('second');
  });

  it('only confirmHeard moves the output up, carrying when it was heard', () => {
    const store = createEngineStore();
    store.downgradeOutput({ status: 'interrupted' });
    store.confirmHeard(2222);
    expect(store.get().output).toEqual({ status: 'verified_at', at: 2222 });
  });

  it('keeps the phase apart from the output: playing never implies audible', () => {
    const store = createEngineStore();
    store.set({ phase: 'playing' });
    expect(store.get().phase).toBe('playing');
    expect(store.get().output).toEqual({ status: 'output_unverified' });
  });
});
