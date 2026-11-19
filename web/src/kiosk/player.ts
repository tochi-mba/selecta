// The kiosk's player (ADR-0445, ADR-0446 "Playing offline"). It plays the zone's horizon from
// the saved files only (never from a URL), so it plays the same online and offline:
//
// - **Where the schedule says.** At every tick it finds the segment whose time covers trusted
//   now and plays it at the right offset; a drift over 2 s is corrected. After a restart the
//   first sound fades in over 5 s.
// - **Past the horizon** (offline longer than the saved music), the fallback reel replays saved
//   songs, never one played in the last hour where the cache allows it, joined by an
//   equal-power crossfade. Each hand-off is logged as `offline_fallback`. Only when nothing
//   saved is left does it stop ("The music will be back shortly").
// - **Output.** Two audio elements feed Web Audio gains, a master gain (the zone volume) and an
//   analyser after the gain, so the health report can tell digital silence from music.
// - **Plays.** Each song that played is logged with its start and seconds played, and uploaded
//   when online (`/api/kiosk/resync`), idempotent by key.

import type { Segment } from '../business/offline/zoneCache';
import { outputMeter } from './meter';

export type PlayableSegment = Segment & { title?: string; artist?: string; song_index?: number; song_id?: number };

export const CROSSFADE_S = 8;
export const DRIFT_S = 2;
export const FALLBACK_SPACING_S = 3600;

export type LogEntry = {
  kind: 'play' | 'offline_fallback' | 'urgent_update';
  idempotency_key: string;
  title?: string;
  artist?: string;
  track_id?: string;
  started_at: number;
  seconds_played?: number;
  recorded_at: number;
};

/** The saved segment covering `now`, with the offset into it; null when none is saved. */
export function segmentAt(segments: readonly PlayableSegment[], now: number, saved: (s: PlayableSegment) => boolean): { segment: PlayableSegment; offsetS: number } | null {
  for (const segment of segments) {
    if (segment.starts_at <= now && now < segment.starts_at + segment.duration_s) {
      return saved(segment) ? { segment, offsetS: now - segment.starts_at } : null;
    }
  }
  return null;
}

/** The fallback reel's next song: a saved song not heard within the spacing, else the one heard
 * longest ago; null when nothing is saved. */
export function fallbackNext(songs: readonly PlayableSegment[], lastPlayed: ReadonlyMap<string, number>, now: number): PlayableSegment | null {
  const playable = songs.filter((s) => (s.kind ?? 'song') === 'song');
  if (!playable.length) return null;
  const fresh = playable.filter((s) => now - (lastPlayed.get(s.id) ?? -Infinity) >= FALLBACK_SPACING_S);
  const pool = fresh.length ? fresh : playable;
  return [...pool].sort((a, b) => (lastPlayed.get(a.id) ?? -Infinity) - (lastPlayed.get(b.id) ?? -Infinity))[0];
}

/** Equal-power fade curves (cos for the outgoing, sin for the incoming). */
export function equalPower(steps = 32): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(steps);
  const fadeOut = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const x = (i / (steps - 1)) * (Math.PI / 2);
    fadeIn[i] = Math.sin(x);
    fadeOut[i] = Math.cos(x);
  }
  return { fadeIn, fadeOut };
}

type Deck = {
  el: HTMLAudioElement;
  gain: GainNode | null;
  segment: PlayableSegment | null;
  url: string | null;
  startedAt: number;
};

export type PlayerOptions = {
  /** The saved file for a segment, or null when it isn't saved. */
  blob: (segment: PlayableSegment) => Promise<Blob | null>;
  saved: (segment: PlayableSegment) => boolean;
  /** Trusted now (epoch seconds), or null when time is unknown. */
  now: () => number | null;
  context?: AudioContext | null;
  createAudio?: () => HTMLAudioElement;
  onLog?: (entry: LogEntry) => void;
};

export type Mode = 'idle' | 'horizon' | 'fallback' | 'nothing_saved';

export function createPlayer(options: PlayerOptions) {
  const context = options.context ?? null;
  const master = context ? context.createGain() : null;
  const analyser = context ? context.createAnalyser() : null;
  if (context && master && analyser) {
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(context.destination);
  }
  const meter = outputMeter(analyser);
  const makeDeck = (): Deck => {
    const el = options.createAudio ? options.createAudio() : new Audio();
    el.preload = 'auto';
    let gain: GainNode | null = null;
    if (context && master) {
      try {
        const source = context.createMediaElementSource(el);
        gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(master);
      } catch {
        gain = null;
      }
    }
    return { el, gain, segment: null, url: null, startedAt: 0 };
  };
  const decks: [Deck, Deck] = [makeDeck(), makeDeck()];
  let active = 0;
  let wanted = false;
  let fadeInS = 0;
  let mode: Mode = 'idle';
  let segments: PlayableSegment[] = [];
  let paused = false;
  let switching = false;
  const lastPlayed = new Map<string, number>();
  const curves = equalPower();

  const ramp = (deck: Deck, curve: Float32Array | number, seconds: number) => {
    if (deck.gain && context) {
      const param = deck.gain.gain;
      param.cancelScheduledValues(context.currentTime);
      if (typeof curve === 'number' || seconds <= 0.05) {
        param.setValueAtTime(typeof curve === 'number' ? curve : curve[curve.length - 1], context.currentTime);
      } else {
        param.setValueCurveAtTime(curve, context.currentTime, seconds);
      }
    } else {
      deck.el.volume = typeof curve === 'number' ? curve : curve[curve.length - 1];
    }
  };

  const log = (deck: Deck, at: number) => {
    const segment = deck.segment;
    if (!segment || (segment.kind ?? 'song') !== 'song' || !options.onLog) return;
    options.onLog({
      kind: 'play',
      idempotency_key: `${segment.id}:${Math.round(deck.startedAt)}`,
      title: segment.title || 'Unknown title',
      artist: segment.artist || '',
      track_id: segment.song_id !== undefined ? String(segment.song_id) : undefined,
      started_at: deck.startedAt,
      seconds_played: Math.max(0, Math.round(at - deck.startedAt)),
      recorded_at: at,
    });
  };

  const release = (deck: Deck, at: number) => {
    log(deck, at);
    deck.el.pause();
    if (deck.url) URL.revokeObjectURL(deck.url);
    deck.url = null;
    deck.segment = null;
  };

  async function switchTo(segment: PlayableSegment, offsetS: number, fadeS: number, at: number): Promise<void> {
    const blob = await options.blob(segment);
    if (!blob) return;
    const outgoing = decks[active];
    const incoming = decks[1 - active];
    if (incoming.segment) release(incoming, at);
    incoming.url = URL.createObjectURL(blob);
    incoming.el.src = incoming.url;
    incoming.segment = segment;
    incoming.startedAt = at - offsetS;
    try {
      incoming.el.currentTime = Math.max(0, offsetS);
    } catch {
      // not seekable until metadata loads; the drift check corrects it on the next tick
    }
    ramp(incoming, 0, 0);
    try {
      await incoming.el.play();
    } catch {
      return; // the browser wants a tap; the screen asks for it
    }
    ramp(incoming, curves.fadeIn, fadeS);
    if (outgoing.segment) {
      ramp(outgoing, curves.fadeOut, fadeS);
      const leaving = outgoing;
      setTimeout(() => {
        if (decks[active] !== leaving) release(leaving, (options.now() ?? at) as number);
      }, Math.max(50, fadeS * 1000));
    }
    active = 1 - active;
    lastPlayed.set(segment.id, at);
  }

  async function tick(): Promise<void> {
    if (switching) return;
    const deck = decks[active];
    if (!wanted || paused) {
      if (deck.segment) {
        ramp(deck, curves.fadeOut, 1);
        setTimeout(() => { if (!wanted || paused) release(deck, options.now() ?? Date.now() / 1000); }, 1000);
      }
      mode = 'idle';
      return;
    }
    const now = options.now();
    const target = now === null ? null : segmentAt(segments, now, options.saved);
    switching = true;
    try {
      if (target) {
        if (deck.segment?.id === target.segment.id) {
          if (Math.abs(deck.el.currentTime - target.offsetS) > DRIFT_S) deck.el.currentTime = target.offsetS;
        } else {
          const boundary = target.offsetS < 1 && deck.segment !== null;
          const fade = fadeInS > 0 ? fadeInS : boundary ? 0.05 : 1.5;
          await switchTo(target.segment, target.offsetS, fade, now as number);
          fadeInS = 0;
        }
        mode = 'horizon';
        return;
      }
      const at = now ?? Date.now() / 1000;
      const remaining = deck.segment ? (deck.el.duration || deck.segment.duration_s) - deck.el.currentTime : 0;
      const needNext = mode !== 'fallback' || !deck.segment || deck.el.ended || remaining <= CROSSFADE_S;
      if (!needNext) return;
      const pick = fallbackNext(segments.filter(options.saved), lastPlayed, at);
      if (!pick) {
        mode = 'nothing_saved';
        if (deck.segment) release(deck, at);
        return;
      }
      await switchTo(pick, 0, fadeInS > 0 ? fadeInS : CROSSFADE_S, at);
      fadeInS = 0;
      mode = 'fallback';
      options.onLog?.({ kind: 'offline_fallback', idempotency_key: `fallback:${pick.id}:${Math.round(at)}`, started_at: at, recorded_at: at });
    } finally {
      switching = false;
    }
  }

  return {
    /** Start (or resume) with a fade-in, from where the schedule says. */
    start(fadeIn = 5) {
      wanted = true;
      fadeInS = fadeIn;
      void tick();
    },
    stop() {
      wanted = false;
      void tick();
    },
    setSegments(next: PlayableSegment[]) { segments = [...next].sort((a, b) => a.starts_at - b.starts_at); },
    setPaused(value: boolean) { paused = value; },
    /** The zone volume (0 to 100). A stale change ramps over 30 s rather than jumping. */
    setVolume(volume: number, rampS = 0.5) {
      const level = Math.max(0, Math.min(100, volume)) / 100;
      if (master && context) {
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setValueAtTime(master.gain.value, context.currentTime);
        master.gain.linearRampToValueAtTime(level, context.currentTime + Math.max(0.05, rampS));
      }
    },
    tick,
    mode: () => mode,
    playing: () => wanted && !paused && !!decks[active].segment && !decks[active].el.paused,
    current: () => decks[active].segment,
    position: () => ({ segment: decks[active].segment, offsetS: decks[active].el.currentTime || 0 }),
    level: () => meter.level(),
    contextState: (): string => (context ? context.state : 'unknown'),
  };
}

export type KioskPlayer = ReturnType<typeof createPlayer>;
