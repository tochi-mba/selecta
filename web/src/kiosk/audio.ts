// Device-local browser audio seam. The kiosk screen can now host an actual speaker.
//
// BZ-2 (the zone player, ADR-0443) and BZ-3 (the offline horizon cache, ADR-0446) plug in here:
// a real implementation plays the zone's horizon, reports `playing()`, and answers
// `savedHoursAhead()` from the offline cache. The kiosk entry must never import from
// web/src/business (customerSeparation.test.ts), so the offline zone cache that BZ-3 keeps in
// web/src/business/offline is reached only through an implementation of this interface that
// lives outside the business folder (or a kiosk-side copy of its rules).
//
// Legacy stubAudio below is retained only for older screen-contract tests; it resumes a silent AudioContext and
// plays one silent buffer. If the context stays suspended, the browser wants a tap first.
// Unlocking the browser NEVER proves a physical speaker played user music.

import { BrowserVenueAudio, type LocalRecording, type PlayerSnapshot, type VenueAudioPort } from '../venue-player/browserAudio';

export interface KioskAudio {
  /** Try to allow sound. Resolves true when the browser lets this page play. */
  unlock(): Promise<boolean>;
  /** True while music is coming out of this player. */
  playing(): boolean;
  /** Hours of music saved on this player ahead of now (0 when nothing is saved). */
  savedHoursAhead(): number;
}

type AudioContextLike = {
  state: string;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): unknown;
  createBufferSource(): { buffer: unknown; connect(target: unknown): void; start(when?: number): void };
  destination: unknown;
};

export function stubAudio(make: () => AudioContextLike | null = defaultContext): KioskAudio {
  let context: AudioContextLike | null = null;
  let unlocked = false;
  return {
    async unlock() {
      if (unlocked) return true;
      try {
        context = context ?? make();
        if (!context) return false;
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(1, 1, 22050);
        source.connect(context.destination);
        source.start(0);
        await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 500))]);
        unlocked = context.state === 'running';
      } catch {
        unlocked = false;
      }
      return unlocked;
    },
    // A silent unlock probe cannot count as playback or a positive heartbeat.
    playing: () => false,
    savedHoursAhead: () => 0,
  };
}

function defaultContext(): AudioContextLike | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike }).AudioContext
    ?? (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Production browser player: actual decoded File audio routed to the OS default output.
 * This is single-zone; no Cloud files, localhost Python or automatic Chromecast/Sonos.
 * Physical speaker acknowledgement is always a separate operator action.
 */
export type BrowserKioskAudio = KioskAudio & {
  importLocal(records: readonly LocalRecording[]): void;
  bindLocal(record: LocalRecording): void;
  prepare(trackId: string): Promise<void>;
  start(trackId: string, generation: number): Promise<void>;
  transition(trackId: string, fadeSeconds?: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  soundCheck(): Promise<void>;
  confirmHeard(): boolean;
  snapshot(): PlayerSnapshot;
  dispose(): Promise<void>;
};

/** Inject the Agent 01 audio executor once its compatible port is ready. */
export function browserKioskAudio(player: VenueAudioPort = new BrowserVenueAudio()): BrowserKioskAudio {
  return {
    unlock: () => player.unlock(),
    playing: () => player.playing(),
    savedHoursAhead: () => player.savedHoursAhead(),
    importLocal: (records) => player.importLocal(records),
    bindLocal: (record) => player.bindLocal(record),
    prepare: (id) => player.prepare(id),
    start: (id, generation) => player.start(id, generation),
    transition: (id, seconds) => player.transition(id, seconds),
    pause: () => player.pause(),
    resume: () => player.resume(),
    stop: () => player.stop(),
    soundCheck: () => player.soundCheck(),
    confirmHeard: () => player.confirmHeard(),
    snapshot: () => player.snapshot(),
    dispose: () => player.dispose(),
  };
}
