import { describe, expect, it, vi } from 'vitest';
import { createEngineContext, isUnsupported } from './context';
import { createEngineStore, UnsupportedHere } from './state';
import { FakeAudioContext, FakeDocument, FakeEvents } from './testAudio';

const open = (overrides: Partial<Parameters<typeof createEngineContext>[0]> = {}) => {
  const store = createEngineStore();
  const fake = new FakeAudioContext();
  const watchedDocument = new FakeDocument();
  const watchedDevices = new FakeEvents();
  const made = createEngineContext({
    fromUserGesture: true,
    store,
    create: () => fake as unknown as AudioContext,
    watchDocument: watchedDocument,
    watchMediaDevices: watchedDevices,
    ...overrides,
  });
  return { store, fake, watchedDocument, watchedDevices, made };
};

describe('creating the context', () => {
  it('refuses without a real user gesture', () => {
    const store = createEngineStore();
    const made = createEngineContext({ fromUserGesture: false, store, watchDocument: null, watchMediaDevices: null });
    expect(isUnsupported(made)).toBe(true);
    expect((made as UnsupportedHere).reason).toMatch(/press/);
  });

  it('refuses with a reason where the sound device will not open', () => {
    const { made } = open({ create: () => { throw new Error('no device'); } });
    expect(isUnsupported(made)).toBe(true);
    expect((made as UnsupportedHere).reason).toMatch(/no device/);
  });

  it('opens from a gesture and hands back the context', () => {
    const { made, fake } = open();
    expect(isUnsupported(made)).toBe(false);
    if (isUnsupported(made)) return;
    expect(made.context).toBe(fake as unknown as AudioContext);
  });
});

describe('truthful downgrades', () => {
  it('marks a system interruption: paused phase, interrupted output', () => {
    const { store, fake, made } = open();
    if (isUnsupported(made)) throw new Error('refused');
    store.set({ phase: 'playing' });
    fake.setState('suspended');
    expect(store.get().phase).toBe('paused');
    expect(store.get().output).toEqual({ status: 'interrupted' });
    expect(store.get().notice).toMatch(/interrupted/);
  });

  it('does not call an intentional hold an interruption', async () => {
    const { store, fake, made } = open();
    if (isUnsupported(made)) throw new Error('refused');
    store.set({ phase: 'playing' });
    await made.hold();
    expect(fake.state).toBe('suspended');
    expect(store.get().phase).toBe('playing');
    expect(store.get().output).toEqual({ status: 'output_unverified' });
  });

  it('turns a hidden tab into uncertainty, and never upgrades when it returns', () => {
    const { store, watchedDocument, made } = open();
    if (isUnsupported(made)) throw new Error('refused');
    store.confirmHeard(10);
    store.set({ phase: 'playing' });
    watchedDocument.visibilityState = 'hidden';
    watchedDocument.fire('visibilitychange');
    expect(store.get().output).toEqual({ status: 'uncertain' });
    watchedDocument.visibilityState = 'visible';
    watchedDocument.fire('visibilitychange');
    expect(store.get().output).toEqual({ status: 'uncertain' });
  });

  it('pauses safely before a route change downgrade, so nothing blasts into a new output', () => {
    const order: string[] = [];
    const { store, watchedDevices, made } = open({ pauseSafely: () => order.push('paused') });
    if (isUnsupported(made)) throw new Error('refused');
    store.confirmHeard(10);
    store.set({ phase: 'playing' });
    store.subscribe((state) => {
      if (state.output.status === 'output_unverified') order.push('downgraded');
    });
    watchedDevices.fire('devicechange');
    expect(order).toEqual(['paused', 'downgraded']);
    expect(store.get().notice).toMatch(/output changed/i);
  });

  it('marks a released wake lock as uncertain', () => {
    const { store, made } = open();
    if (isUnsupported(made)) throw new Error('refused');
    const sentinel = new FakeEvents();
    made.watchWakeLock(sentinel);
    store.confirmHeard(10);
    sentinel.fire('release');
    expect(store.get().output).toEqual({ status: 'uncertain' });
  });

  it('stops watching after dispose', () => {
    const { store, watchedDocument, made } = open();
    if (isUnsupported(made)) throw new Error('refused');
    made.dispose();
    store.confirmHeard(10);
    watchedDocument.visibilityState = 'hidden';
    watchedDocument.fire('visibilitychange');
    expect(store.get().output).toEqual({ status: 'verified_at', at: 10 });
  });
});

describe('waking the context', () => {
  it('reports whether the context actually runs', async () => {
    const { fake, made } = open();
    if (isUnsupported(made)) throw new Error('refused');
    fake.setState('suspended');
    expect(await made.wake()).toBe(true);
    expect(fake.state).toBe('running');
  });

  it('gives up on a browser that never answers resume', async () => {
    vi.useFakeTimers();
    try {
      const { fake, made } = open();
      if (isUnsupported(made)) throw new Error('refused');
      fake.setState('suspended');
      fake.resume = () => new Promise<void>(() => {});
      const asked = made.wake();
      await vi.runAllTimersAsync();
      expect(await asked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
