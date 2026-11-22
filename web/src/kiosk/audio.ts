// The kiosk's sound: autoplay detection and the zone audio (ADR-0445 "Autoplay", ADR-0446).
//
// Browsers allow sound without a tap only in some cases, so the kiosk detects rather than
// assumes: it resumes an AudioContext and plays one silent buffer. If the context stays
// suspended, autoplay is blocked: the screen shows Tap to start and the manager is alerted.
// One tap is enough for the life of the page.
//
// `zoneAudio` joins the player (player.ts) to the saved horizon (zoneCache): it plays only
// from saved files, reports whether music is coming out, and how many hours are saved ahead.
// The kiosk entry may import exactly two files from web/src/business: the offline zone cache
// and the offline clock, which import nothing (kioskBundle.test.ts keeps it that way).

import type { ZoneCache } from '../business/offline/zoneCache';
import { createPlayer, type KioskPlayer, type LogEntry, type PlayableSegment } from './player';

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

/** Plays one silent buffer and reports whether the context runs: no sound either way. */
export async function detectAutoplay(context: AudioContextLike | null, waitMs = 500): Promise<boolean> {
  if (!context) return false;
  try {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22050);
    source.connect(context.destination);
    source.start(0);
    await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, waitMs))]);
    return context.state === 'running';
  } catch {
    return false;
  }
}

export function makeAudioContext(): AudioContext | null {
  const scope = globalThis as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  try {
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export type ZoneAudio = KioskAudio & {
  player: KioskPlayer;
  context: AudioContext | null;
  unlocked(): boolean;
};

export function zoneAudio(options: {
  cache: ZoneCache;
  now: () => number | null;
  onLog?: (entry: LogEntry) => void;
  context?: AudioContext | null;
  createAudio?: () => HTMLAudioElement;
}): ZoneAudio {
  const context = options.context === undefined ? makeAudioContext() : options.context;
  let isUnlocked = false;
  const player = createPlayer({
    context,
    now: options.now,
    createAudio: options.createAudio,
    onLog: options.onLog,
    saved: (segment: PlayableSegment) => options.cache.has(segment),
    blob: (segment: PlayableSegment) => options.cache.get(segment),
  });
  return {
    player,
    context,
    unlocked: () => isUnlocked,
    async unlock() {
      if (isUnlocked) return true;
      isUnlocked = await detectAutoplay(context as unknown as AudioContextLike | null);
      return isUnlocked;
    },
    playing: () => player.playing(),
    savedHoursAhead() {
      const now = options.now();
      return now === null ? 0 : Math.round((options.cache.coverageSeconds(now) / 3600) * 10) / 10;
    },
  };
}
