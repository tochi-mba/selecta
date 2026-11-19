import { AudioSession, openEngineAudio, requestScreenWakeLock, WakeLockAnswer } from '../onboarding/deps';
import { browserStorage, KeyValue } from '../onboarding/state';
import type { CapabilityRecord } from './capabilityRecord';
import { runProbeSuite, SuiteInput } from './probeSuite';

/** What the venue posture flow needs from the world, injectable so tests drive every branch.
 * The defaults reuse the onboarding spine's engine and wake-lock openers (BF-0460-02). */

export type Watched = {
  addEventListener(type: string, listen: () => void): void;
  removeEventListener(type: string, listen: () => void): void;
};
export type WatchedDocument = Watched & { visibilityState: string };

/** The Battery Status API's shape, where a browser has it (feature-detected, Chromium only). */
export type BatteryLike = Watched & { charging: boolean };

export type VenueDeps = {
  storage: KeyValue | null;
  /** Called only inside a press. A string is why this device cannot open audio. */
  openAudio(): AudioSession | string;
  requestWakeLock(): Promise<WakeLockAnswer>;
  battery(): Promise<BatteryLike | null>;
  runSuite(input: SuiteInput): Promise<CapabilityRecord>;
  watchDocument: WatchedDocument | null;
  watchDevices: Watched | null;
  /** Seconds since epoch. */
  now(): number;
};

export function defaultVenueDeps(): VenueDeps {
  return {
    storage: browserStorage(),
    openAudio: openEngineAudio,
    requestWakeLock: requestScreenWakeLock,
    battery: async () => {
      const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> });
      if (!nav?.getBattery) return null;
      try {
        return await nav.getBattery();
      } catch {
        return null;
      }
    },
    runSuite: runProbeSuite,
    watchDocument: typeof document === 'undefined' ? null : document,
    watchDevices: typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null,
    now: () => Date.now() / 1000,
  };
}

const LAST_HEARD = 'selecta.venue.last-heard.';
const RECORD = 'selecta.venue.record.';

/** When a person last heard this tablet, kept only to show "last confirmed at"; never trusted. */
export function loadLastHeard(storage: KeyValue | null, workspaceId: string): number | null {
  try {
    const raw = storage?.getItem(`${LAST_HEARD}${workspaceId}`);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveLastHeard(storage: KeyValue | null, workspaceId: string, at: number): void {
  try {
    storage?.setItem(`${LAST_HEARD}${workspaceId}`, String(at));
  } catch {
    // storage refused: the history line is lost, never the truth
  }
}

/** The newest capability record measured here, kept for the device-record programme. */
export function saveRecord(storage: KeyValue | null, workspaceId: string, record: CapabilityRecord): void {
  try {
    storage?.setItem(`${RECORD}${workspaceId}`, JSON.stringify(record));
  } catch {
    // storage refused: the record is measured again next time
  }
}
