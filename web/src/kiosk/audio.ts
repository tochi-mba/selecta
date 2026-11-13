// The seam between the kiosk screen and the kiosk player. This screen does not play music.
//
// BZ-2 (the zone player, ADR-0443) and BZ-3 (the offline horizon cache, ADR-0446) plug in here:
// a real implementation plays the zone's horizon, reports `playing()`, and answers
// `savedHoursAhead()` from the offline cache. The kiosk entry must never import from
// web/src/business (customerSeparation.test.ts), so the offline zone cache that BZ-3 keeps in
// web/src/business/offline is reached only through an implementation of this interface that
// lives outside the business folder (or a kiosk-side copy of its rules).
//
// The stub below only does autoplay detection (ADR-0445): it resumes a silent AudioContext and
// plays one silent buffer. If the context stays suspended, the browser wants a tap first.

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
    playing: () => unlocked,
    savedHoursAhead: () => 0,
  };
}

function defaultContext(): AudioContextLike | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike }).AudioContext
    ?? (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}
