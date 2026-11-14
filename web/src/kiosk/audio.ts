// Device-local browser audio seam. The kiosk screen can now host an actual speaker.
//
// BZ-2 (the zone player, ADR-0443) and BZ-3 (the offline horizon cache, ADR-0446) plug in here:
// a real implementation plays the zone's horizon, reports `playing()`, and answers
// `savedHoursAhead()` from the offline cache. The kiosk entry must never import from
// web/src/business (customerSeparation.test.ts), so the offline zone cache that BZ-3 keeps in
// web/src/business/offline is reached only through an implementation of this interface that
// lives outside the business folder (or a kiosk-side copy of its rules).
//
// Unlocking a browser context never proves its speaker is physically audible.

import { BrowserVenueAudio, type LocalRecording, type PlayerSnapshot, type VenueAudioPort } from '../venue-player/browserAudio';

export interface KioskAudio {
  /** Try to allow sound. Resolves true when the browser lets this page play. */
  unlock(): Promise<boolean>;
  /** True while music is coming out of this player. */
  playing(): boolean;
  /** Hours of music saved on this player ahead of now (0 when nothing is saved). */
  savedHoursAhead(): number;
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
