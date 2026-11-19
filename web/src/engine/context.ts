import { BACKGROUND_TAB_NOTICE, downgradeDeviceOutput, noticeWhilePlaying, OUTPUT_CHANGED_NOTICE } from './state';
import type { EngineStore, UnsupportedHere } from './state';

/** AudioContext lifecycle for the browser runtime (ADR-0457).
 *
 * The context is made only from a real user gesture: the caller sets `fromUserGesture` inside its
 * own event handler, and anything else is refused. Once made, the handle watches the things that
 * can quietly take the sound away (visibility, wake-lock release, output route changes, system
 * interruptions) and downgrades the output status for each. These watchers only ever move the
 * status down; nothing here can claim the sound became audible again (ADR-0460).
 */

/** A browser can refuse without saying so by never answering resume(); stop waiting after this. */
export const WAKE_WAIT_MS = 3000;
export const ENGINE_SAMPLE_RATE = 44100;

type Watched = {
  addEventListener(type: string, listen: () => void): void;
  removeEventListener(type: string, listen: () => void): void;
};
type WatchedDocument = Watched & { visibilityState: string };
/** The shape of a WakeLockSentinel the runtime cares about. */
export type WakeLockLike = {
  addEventListener(type: 'release', listen: () => void): void;
  removeEventListener?(type: 'release', listen: () => void): void;
};

export type EngineContextOptions = {
  /** Must be set to true inside a real event handler. The engine never makes sound by itself. */
  fromUserGesture: boolean;
  store: EngineStore;
  sampleRate?: number;
  /** Called before a route-change downgrade, so nothing blasts into a new output. */
  pauseSafely?: () => void;
  /** The real constructor by default; a fake in tests. */
  create?: (options: AudioContextOptions) => AudioContext;
  /** The document and media devices to watch; the real ones by default, fakes in tests. */
  watchDocument?: WatchedDocument | null;
  watchMediaDevices?: Watched | null;
};

export type EngineContext = {
  context: AudioContext;
  /** Ask for the sound within a gesture; reports whether the context actually runs. */
  wake(): Promise<boolean>;
  /** Stop the sound on purpose, which is not the system interrupting it. */
  hold(): Promise<void>;
  /** Watch a wake lock; its release means nobody can promise the screen stays on. */
  watchWakeLock(sentinel: WakeLockLike): void;
  dispose(): void;
};

export function createEngineContext(options: EngineContextOptions): EngineContext | UnsupportedHere {
  const { store } = options;
  if (options.fromUserGesture !== true) {
    return { state: 'unsupported_here', reason: 'Sound can only start from a real press, and nothing was pressed.' };
  }
  const make = options.create
    ?? (typeof AudioContext === 'undefined' ? null : (made: AudioContextOptions) => new AudioContext(made));
  if (!make) {
    return { state: 'unsupported_here', reason: 'This browser has no Web Audio, so SelectaDJ cannot play here.' };
  }
  let context: AudioContext;
  try {
    context = make({ sampleRate: options.sampleRate ?? ENGINE_SAMPLE_RATE });
  } catch (error) {
    return { state: 'unsupported_here', reason: `The sound device refused to open: ${(error as Error).message ?? 'unknown reason'}.` };
  }

  let holdingSound = false;
  let disposed = false;
  const wakeLocks = new Set<WakeLockLike>();

  // The system can take the sound away by itself, on a phone call for example. What is shown
  // follows what is really happening, rather than saying it is playing (mirrors player.ts).
  context.onstatechange = () => {
    if (holdingSound || disposed) return;
    if (context.state !== 'running' && store.get().phase === 'playing') {
      store.set({ phase: 'paused' });
      // this context's own interruption, not the device's: only this engine hears about it
      store.downgradeOutput({ status: 'interrupted' }, 'The sound was interrupted. Press play to carry on.');
    }
  };

  const watchedDocument = options.watchDocument !== undefined
    ? options.watchDocument
    : (typeof document === 'undefined' ? null : document);
  const watchedDevices = options.watchMediaDevices !== undefined
    ? options.watchMediaDevices
    : (typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null);

  // A hidden tab may be throttled or discarded without a word; nobody can tell whether sound still
  // reaches the speakers. Coming back to the foreground proves nothing, so there is no upgrade.
  const onVisibility = () => {
    if (disposed || watchedDocument?.visibilityState !== 'hidden') return;
    // only an engine that is playing has sound to promise; an idle one shows no warning
    downgradeDeviceOutput({ status: 'uncertain' }, noticeWhilePlaying(BACKGROUND_TAB_NOTICE), store);
  };
  watchedDocument?.addEventListener('visibilitychange', onVisibility);

  // Physical outputs can vanish independently of the graph. Pause safely first (no blast on a new
  // route), then say the output is unverified until it is checked again. Never auto-resume.
  const onDeviceChange = () => {
    if (disposed) return;
    const playing = store.get().phase === 'playing';
    if (playing) options.pauseSafely?.();
    downgradeDeviceOutput({ status: 'output_unverified' }, OUTPUT_CHANGED_NOTICE, store);
  };
  watchedDevices?.addEventListener('devicechange', onDeviceChange);

  const onWakeRelease = () => {
    if (disposed) return;
    downgradeDeviceOutput(
      { status: 'uncertain' },
      'The screen wake lock was released, so the device may sleep and stop the sound.',
      store,
    );
  };

  return {
    context,
    async wake() {
      const isRunning = () => context.state === 'running';
      if (isRunning() && !holdingSound) return true;
      let wait: number | undefined;
      try {
        await Promise.race([
          context.resume(),
          new Promise((settled) => { wait = window.setTimeout(settled, WAKE_WAIT_MS); }),
        ]);
      } catch {
        // whether it worked is what is checked next
      } finally {
        if (wait !== undefined) globalThis.clearTimeout(wait);
      }
      return isRunning();
    },
    async hold() {
      holdingSound = true;
      try {
        await context.suspend();
      } finally {
        holdingSound = false;
      }
    },
    watchWakeLock(sentinel) {
      if (disposed || wakeLocks.has(sentinel)) return;
      wakeLocks.add(sentinel);
      sentinel.addEventListener('release', onWakeRelease);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      watchedDocument?.removeEventListener('visibilitychange', onVisibility);
      watchedDevices?.removeEventListener('devicechange', onDeviceChange);
      for (const sentinel of wakeLocks) sentinel.removeEventListener?.('release', onWakeRelease);
      wakeLocks.clear();
      context.onstatechange = null;
      void context.close?.().catch(() => undefined);
    },
  };
}

/** Whether createEngineContext refused. */
export function isUnsupported<T>(made: T | UnsupportedHere): made is UnsupportedHere {
  return typeof made === 'object' && made !== null && (made as UnsupportedHere).state === 'unsupported_here';
}
