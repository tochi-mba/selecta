import { describe, expect, it, vi } from 'vitest';
import type { PrefetchState } from '../../dsp/stems';
import { engineStemsStore, splitterFrom, windowsFrom, type EngineFacts } from './engineStore';

const facts = (more: Partial<EngineFacts> = {}): EngineFacts => ({
  licenceHold: null, deviceCannot: null, crash: { clear: true }, model: { kind: 'absent' }, artefactBytes: 170_000_000,
  downloadPaused: false, prefetch: null, programme: [1, 2, 3], role: 'speaker', metered: null, ...more,
});

const win = (songId: number, role: 'tail' | 'head', status: PrefetchState['windows'][number]['status']) => ({ id: `${songId}-${role}`, songId, window: { role, startMs: 0, endMs: 1 }, status });

describe('the engine, as the stems surfaces read it', () => {
  it('puts the licence hold first: nothing else about the device matters until it lifts', () => {
    expect(splitterFrom(facts({ licenceHold: 'the stem model’s licence is still under review', crash: { clear: false, reason: 'x', at: 1 } })))
      .toEqual({ state: 'unsupported', code: 'licence', reason: 'the stem model’s licence is still under review' });
  });

  it('says why a device can not split, then whether a splitter exists to download', () => {
    expect(splitterFrom(facts({ crash: { clear: false, reason: 'the page stopped', at: 1 } }))).toMatchObject({ code: 'crash_guard' });
    expect(splitterFrom(facts({ deviceCannot: 'no WebGPU here' }))).toMatchObject({ code: 'no_webgpu_wasm_slow', reason: 'no WebGPU here' });
    expect(splitterFrom(facts({ artefactBytes: null }))).toMatchObject({ code: 'other', reason: 'the stem splitter isn’t published, so songs play whole' });
    expect(splitterFrom(facts())).toEqual({ state: 'absent', bytes: 170_000_000, needBytes: 340_000_000 });
  });

  it('follows the download: progress, a paused part, failures by their reason, then ready or paused', () => {
    expect(splitterFrom(facts({ model: { kind: 'downloading', received: 5, total: 10 } }))).toEqual({ state: 'downloading', received: 5, total: 10, paused: false });
    expect(splitterFrom(facts({ model: { kind: 'absent', partialBytes: 4 }, downloadPaused: true }))).toEqual({ state: 'downloading', received: 4, total: 170_000_000, paused: true });
    expect(splitterFrom(facts({ model: { kind: 'failed', why: 'storage_full' } }))).toEqual({ state: 'failed', why: 'storage_full', detail: undefined });
    expect(splitterFrom(facts({ model: { kind: 'failed', why: 'checksum' } }))).toMatchObject({ state: 'failed', why: 'checksum' });
    expect(splitterFrom(facts({ model: { kind: 'ready' } }))).toMatchObject({ state: 'ready' });
    const paused = { windows: [], paused: [{ reason: 'battery' as const, message: 'low battery' }] };
    expect(splitterFrom(facts({ model: { kind: 'ready' }, prefetch: paused }))).toEqual({ state: 'paused', why: 'battery' });
  });

  it('names each transition by its two songs: ready only when both windows are, the first problem says why', () => {
    const prefetch: PrefetchState = {
      paused: [],
      windows: [
        win(1, 'tail', { state: 'ready' }), win(2, 'head', { state: 'running', progress: 0.5 }),
        win(2, 'tail', { state: 'queued' }), win(3, 'head', { state: 'failed', why: 'not_connected', detail: 'not connected here' }),
      ],
    };
    expect(windowsFrom(prefetch, [1, 2, 3])).toEqual({
      '1>2': { state: 'running', progress: 0.75 },
      '2>3': { state: 'failed', why: 'not connected here' },
    });
  });

  it('keeps one snapshot object until something in it changes', () => {
    let current = facts();
    const listeners: (() => void)[] = [];
    const source = { get: () => 0, subscribe: (listener: () => void) => { listeners.push(listener); return () => undefined; } };
    const store = engineStemsStore(() => current, [source], { download: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), remove: vi.fn(), retryAfterCrash: vi.fn() });
    const heard = vi.fn();
    store.subscribe(heard);
    const first = store.get();
    expect(store.get()).toBe(first);
    listeners[0]();
    expect(heard).not.toHaveBeenCalled();
    current = facts({ model: { kind: 'ready' } });
    listeners[0]();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.get().splitter.state).toBe('ready');
  });
});
