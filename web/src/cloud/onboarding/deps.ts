import { confirmDeviceOutput, createEngine, downgradeDeviceOutput, isUnsupported } from '../../engine';
import type { Engine, EngineContext, EngineState, ProbeResult } from '../../engine';
import { dirPicker, directoryInput, MediaStore, runImport } from '../../media';
import type { Capability, DirectoryHandleLike, ImportEvent, ImportSource, ImportSummary } from '../../media';
import { browserStorage, KeyValue } from './state';
import { flagOn } from '../../flags';
import { fingerprintOption, importRunnerFor } from '../importResume';

/** What the onboarding spine needs from the world, injectable so tests can drive every branch.
 *
 * The defaults use the engine and media modules by their public contracts only. Audio is opened
 * from a real press (`openAudio` is only ever called inside a click handler) and the sound check's
 * only way to verified is `confirmHeard`, which the spine calls from the "I heard it" button and
 * nowhere else (ADR-0460). */

export type AudioSession = {
  /** The capability probe: does an audio worklet really run on this device? */
  probe(): Promise<{ ok: boolean; reason?: string }>;
  /** The same probe with its measured numbers, for the capability record (BF-0460-01). */
  probeDetail?(): Promise<ProbeResult>;
  /** The engine's own truthful state; downgrades (visibility, wake lock, route) arrive here. */
  engineState?(): EngineState;
  subscribe?(watch: (state: EngineState) => void): () => void;
  /** Called when the system stops the audio context (a call, another app, an OS interruption)
   * without anyone pressing stop; returns the unsubscribe. */
  onInterrupted?(listen: () => void): () => void;
  /** Ask for sound within a press; true only if the audio context is really running. */
  wake(): Promise<boolean>;
  /** Play the short, quiet check tone through the engine's own output. */
  playTone(): Promise<void>;
  /** A person said they heard the tone: the one way output becomes verified. */
  confirmHeard(atSeconds: number): void;
  /** A person said they heard nothing: output stays (or becomes) unverified. */
  markUnverified(): void;
  /** Hand a wake lock to the engine so its release downgrades the status honestly. */
  watchWakeLock?(sentinel: { addEventListener(type: 'release', listen: () => void): void }): void;
  dispose(): void;
};

export type WakeLockAnswer = { result: 'held'; sentinel: WakeSentinel } | { result: 'unsupported' } | { result: 'refused'; reason: string };
export type WakeSentinel = { release(): Promise<void>; addEventListener(type: 'release', listen: () => void): void };

export type Pickers = {
  directoryInput(): Capability;
  dirPicker(): Capability;
  /** The File System Access folder picker, where `dirPicker` says it exists. */
  pickDirectory?(): Promise<DirectoryHandleLike>;
};

export type SpineDeps = {
  storage: KeyValue | null;
  pickers: Pickers;
  importMusic(source: ImportSource, onProgress: (event: ImportEvent) => void, signal: AbortSignal): Promise<ImportSummary>;
  /** Called only inside a press. A string is the reason this device cannot open audio. */
  openAudio(): AudioSession | string;
  requestWakeLock(): Promise<WakeLockAnswer>;
  /** Seconds since epoch. */
  now(): number;
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const TONE_HZ = 440;
const TONE_SECONDS = 1.2;
/** Quiet on purpose: a check tone must never startle a room through a big speaker. */
const TONE_GAIN = 0.15;

function engineSession(engine: Engine, made: EngineContext): AudioSession {
  return {
    probe: async () => {
      const answer = await engine.probe(made.context);
      return answer.ok ? { ok: true } : { ok: false, reason: answer.reason };
    },
    probeDetail: () => engine.probe(made.context),
    engineState: () => engine.store.get(),
    subscribe: (watch) => engine.store.subscribe(watch),
    onInterrupted: (listen) => {
      const context = made.context;
      const changed = () => { if (context.state !== 'running' && context.state !== 'closed') listen(); };
      context.addEventListener('statechange', changed);
      return () => context.removeEventListener('statechange', changed);
    },
    wake: () => made.wake(),
    playTone: async () => {
      const context = made.context;
      await made.wake();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = TONE_HZ;
      const start = context.currentTime;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(TONE_GAIN, start + 0.05);
      gain.gain.setValueAtTime(TONE_GAIN, start + TONE_SECONDS - 0.15);
      gain.gain.linearRampToValueAtTime(0, start + TONE_SECONDS);
      oscillator.connect(gain).connect(context.destination);
      await new Promise<void>((done) => {
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); done(); };
        oscillator.start(start);
        oscillator.stop(start + TONE_SECONDS);
      });
    },
    confirmHeard: confirmDeviceOutput,
    markUnverified: () => downgradeDeviceOutput({ status: 'output_unverified' }, 'Nobody has confirmed hearing this device yet.'),
    watchWakeLock: (sentinel) => made.watchWakeLock(sentinel),
    dispose: () => engine.dispose(),
  };
}

/** Open the browser engine from inside a press; a string is why this device cannot. Shared by the
 * onboarding spine and the venue posture flow (BF-0460-02). */
export function openEngineAudio(): AudioSession | string {
  const engine = createEngine();
  const made = engine.openContext({ fromUserGesture: true });
  if (isUnsupported(made)) {
    engine.dispose();
    return made.reason;
  }
  return engineSession(engine, made);
}

/** Ask the browser to keep the screen on. Feature-detected: no wake lock API is 'unsupported'. */
export async function requestScreenWakeLock(): Promise<WakeLockAnswer> {
  const api = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } }).wakeLock;
  if (!api) return { result: 'unsupported' };
  try {
    return { result: 'held', sentinel: await api.request('screen') };
  } catch (error) {
    return { result: 'refused', reason: (error as Error)?.message || 'The browser did not say why.' };
  }
}

export function defaultDeps(request: Request, workspaceId: string): SpineDeps {
  const storage = browserStorage();
  return {
    storage,
    pickers: {
      directoryInput,
      dirPicker,
      pickDirectory: async () => {
        const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker;
        if (!picker) throw new Error('This browser has no folder picker.');
        return picker.call(window);
      },
    },
    importMusic: async (source, onProgress, signal) => {
      // cloud.resilient_import: the journalled runner every import surface shares
      if (flagOn('cloud.resilient_import')) return importRunnerFor({ request, openStore: () => MediaStore.open(workspaceId), workspaceId })(source, onProgress, signal);
      const store = await MediaStore.open(workspaceId);
      return runImport({ source, request, store, deviceId: browserProfileId(storage, workspaceId), onProgress, signal, ...(await fingerprintOption(workspaceId)) });
    },
    openAudio: openEngineAudio,
    requestWakeLock: requestScreenWakeLock,
    now: () => Date.now() / 1000,
  };
}

/** A stable, meaningless id for this browser profile, for the availability report (never a path
 * or a name). Shares the device key the Devices panel uses when one exists. */
function browserProfileId(storage: KeyValue | null, workspaceId: string): string {
  const shared = `selecta.device.${workspaceId}`;
  const own = `selecta.media-profile.${workspaceId}`;
  try {
    const known = storage?.getItem(shared) ?? storage?.getItem(own);
    if (known) return known;
  } catch {
    // fall through to a fresh id
  }
  const made = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    storage?.setItem(own, made);
  } catch {
    // an id for this visit only
  }
  return made;
}
