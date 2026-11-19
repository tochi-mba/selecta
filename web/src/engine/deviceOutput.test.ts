import { afterEach, describe, expect, it } from 'vitest';
import { createEngineContext, isUnsupported } from './context';
import {
  BACKGROUND_TAB_NOTICE,
  confirmDeviceOutput,
  createEngineStore,
  downgradeDeviceOutput,
  OUTPUT_CHANGED_NOTICE,
  registerDeviceOutputStore,
  resetDeviceOutputForTests,
} from './state';
import { FakeAudioContext, FakeDocument, FakeEvents } from './testAudio';

// The shared device-output confirmation (ADR-0460): one physical output per tab, so a person's
// answer and device-wide losses reach every live engine; a context's own interruption does not.

const registered = () => {
  const store = createEngineStore();
  registerDeviceOutputStore(store);
  return store;
};

const hideTab = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  resetDeviceOutputForTests();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('confirmDeviceOutput', () => {
  it('confirms every live engine at once, since they feed the same output', () => {
    const check = registered();
    const playback = registered();
    confirmDeviceOutput(42);
    expect(check.get().output).toEqual({ status: 'verified_at', at: 42 });
    expect(playback.get().output).toEqual({ status: 'verified_at', at: 42 });
  });

  it('leaves an engine that is not registered alone', () => {
    const standalone = createEngineStore();
    confirmDeviceOutput(42);
    expect(standalone.get().output).toEqual({ status: 'output_unverified' });
  });
});

describe('registerDeviceOutputStore', () => {
  it('starts a later engine confirmed when a person already confirmed', () => {
    confirmDeviceOutput(7);
    const later = registered();
    expect(later.get().output).toEqual({ status: 'verified_at', at: 7 });
  });

  it('starts unverified once a device-wide downgrade forgot the confirmation', () => {
    confirmDeviceOutput(7);
    downgradeDeviceOutput({ status: 'output_unverified' }, OUTPUT_CHANGED_NOTICE);
    expect(registered().get().output).toEqual({ status: 'output_unverified' });
  });

  it('stops sharing with an engine that left', () => {
    const store = createEngineStore();
    const leave = registerDeviceOutputStore(store);
    leave();
    confirmDeviceOutput(9);
    expect(store.get().output).toEqual({ status: 'output_unverified' });
  });
});

describe('downgradeDeviceOutput', () => {
  it('takes a device-wide loss to every live engine', () => {
    const one = registered();
    const two = registered();
    confirmDeviceOutput(3);
    downgradeDeviceOutput({ status: 'output_unverified' }, OUTPUT_CHANGED_NOTICE, one);
    for (const store of [one, two]) {
      expect(store.get().output).toEqual({ status: 'output_unverified' });
      expect(store.get().notice).toBe(OUTPUT_CHANGED_NOTICE);
    }
  });

  it('still downgrades a standalone source that never registered', () => {
    const standalone = createEngineStore();
    downgradeDeviceOutput({ status: 'uncertain' }, 'gone', standalone);
    expect(standalone.get().output).toEqual({ status: 'uncertain' });
    expect(standalone.get().notice).toBe('gone');
  });

  it('keeps an interruption with the engine it happened to, and keeps the confirmation', () => {
    const interrupted = registered();
    const other = registered();
    confirmDeviceOutput(5);
    downgradeDeviceOutput({ status: 'interrupted' }, 'The sound was interrupted.', interrupted);
    expect(interrupted.get().output).toEqual({ status: 'interrupted' });
    expect(other.get().output).toEqual({ status: 'verified_at', at: 5 });
    expect(other.get().notice).toBe('');
    expect(registered().get().output).toEqual({ status: 'verified_at', at: 5 });
  });

  it('works a per-engine notice out for each engine', () => {
    const playing = registered();
    const idle = registered();
    playing.set({ phase: 'playing' });
    downgradeDeviceOutput({ status: 'uncertain' }, (store) => (store === playing ? 'only you' : undefined));
    expect(playing.get().notice).toBe('only you');
    expect(idle.get().notice).toBe('');
    expect(idle.get().output).toEqual({ status: 'uncertain' });
  });
});

describe('the page watchers a confirmation attaches', () => {
  it('give the background-tab notice only to engines that are playing', () => {
    const playing = registered();
    const idle = registered();
    playing.set({ phase: 'playing' });
    confirmDeviceOutput(11);
    hideTab();
    expect(playing.get().output).toEqual({ status: 'uncertain' });
    expect(playing.get().notice).toBe(BACKGROUND_TAB_NOTICE);
    expect(idle.get().output).toEqual({ status: 'uncertain' });
    expect(idle.get().notice).toBe('');
  });

  it('are detached by the reset, so nothing leaks into the next test', () => {
    confirmDeviceOutput(11);
    resetDeviceOutputForTests();
    const store = registered();
    store.confirmHeard(12);
    hideTab();
    expect(store.get().output).toEqual({ status: 'verified_at', at: 12 });
  });
});

describe('resetDeviceOutputForTests', () => {
  it('forgets the registered engines and the shared confirmation', () => {
    const before = registered();
    confirmDeviceOutput(1);
    resetDeviceOutputForTests();
    confirmDeviceOutput(2);
    expect(before.get().output).toEqual({ status: 'verified_at', at: 1 });
    resetDeviceOutputForTests();
    expect(registered().get().output).toEqual({ status: 'output_unverified' });
  });
});

describe('an engine context', () => {
  const opened = (store = registered()) => {
    const fake = new FakeAudioContext();
    const watchedDocument = new FakeDocument();
    const made = createEngineContext({
      fromUserGesture: true,
      store,
      create: () => fake as unknown as AudioContext,
      watchDocument: watchedDocument,
      watchMediaDevices: new FakeEvents(),
    });
    if (isUnsupported(made)) throw new Error('refused');
    return { store, fake, watchedDocument };
  };

  it('keeps its own interruption local instead of telling every engine', () => {
    const other = registered();
    const { store, fake } = opened();
    confirmDeviceOutput(20);
    store.set({ phase: 'playing' });
    fake.setState('suspended');
    expect(store.get().output).toEqual({ status: 'interrupted' });
    expect(other.get().output).toEqual({ status: 'verified_at', at: 20 });
  });

  it('shows no warning on an idle engine when the tab hides, but still drops certainty', () => {
    const { store, watchedDocument } = opened();
    store.confirmHeard(30);
    watchedDocument.visibilityState = 'hidden';
    watchedDocument.fire('visibilitychange');
    expect(store.get().output).toEqual({ status: 'uncertain' });
    expect(store.get().notice).toBe('');
  });
});
