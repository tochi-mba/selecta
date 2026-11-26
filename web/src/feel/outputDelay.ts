/** How far behind the analyser the speakers are (T-20261125-6dc8).
 *
 * The analyser sees samples before they reach the output, and the player's song clock is the
 * audio context's clock, not what is heard. On wired speakers the gap is a few milliseconds; on
 * Bluetooth or AirPlay it is often 150 to 300 ms, so a pulse drawn on the analysed kick lands
 * visibly before the kick is heard. Where the browser reports the gap (`outputLatency`, else
 * `baseLatency`) the beat bus delays each pulse by it and the hand-over visuals read the song
 * clock that much earlier.
 *
 * Read only: the number comes from the audio context the player's existing analyser taps already
 * belong to, so nothing here reaches into the engine or changes scheduling, gains or the hand-over.
 * Many browsers report 0 or nothing; then the delay is 0 and nothing changes at all. */

import { feelOn } from './root';

/** A reported latency past this is treated as this: a wrong number must never make the chrome
 * trail the music by more than half a second. */
export const MAX_OUTPUT_DELAY_MS = 500;

type Latent = { outputLatency?: number; baseLatency?: number };
type Tapped = { getVisualTaps?: () => { left: { context: unknown } } | null };

let delayMs = 0;

/** The delay, in milliseconds, from a context's reported latency: 0 when unreported. */
export function delayFrom(context: unknown): number {
  const latent = (context ?? {}) as Latent;
  for (const seconds of [latent.outputLatency, latent.baseLatency]) {
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      return Math.min(MAX_OUTPUT_DELAY_MS, Math.round(seconds * 1000));
    }
  }
  return 0;
}

function contextOf(player: Tapped): unknown {
  try {
    return player.getVisualTaps?.()?.left.context ?? null;
  } catch {
    return null;
  }
}

/** Read the delay now, from the player's own taps. Called when playback starts and when the
 * output device changes; music with no taps here (hosted, or on another device) reads 0. */
export function readOutputDelay(player: Tapped): number {
  delayMs = delayFrom(contextOf(player));
  return delayMs;
}

/** The delay last read, in milliseconds. It belongs to the music feel, so with both of its parts
 * off (the flags, or a neutral page) it is 0 and the hand-over bar draws exactly as before. */
export function outputDelayMs(): number {
  return delayMs > 0 && (feelOn('music') || feelOn('ambient')) ? delayMs : 0;
}

/** Read the delay again whenever the output changes (headphones joining or leaving). Returns a
 * stop. */
export function watchOutputDelay(player: Tapped): () => void {
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const read = () => { readOutputDelay(player); };
  devices?.addEventListener?.('devicechange', read);
  // Chromium also says when the context itself moves to another output
  const context = contextOf(player) as EventTarget | null;
  const sink = context && typeof context.addEventListener === 'function' ? context : null;
  sink?.addEventListener('sinkchange', read);
  return () => {
    devices?.removeEventListener?.('devicechange', read);
    sink?.removeEventListener('sinkchange', read);
  };
}

/** For tests. */
export function resetOutputDelay() {
  delayMs = 0;
}
