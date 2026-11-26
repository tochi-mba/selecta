/** Which source samples a script reads, apart from the renderer so the page can cut the windows it
 * sends to the render worker without loading the DSP (moved from engine.ts unchanged). */

import { roundHalfEven as intRound } from './npy';
import { heardWarp, SAMPLE_RATE, type SourceRef, type TransitionScript } from './script';

/** The source samples a script reads, one window per source (parts reading the same source share
 * one window covering all of them), so a caller can decode and send only those windows and the
 * worker never holds more. In source samples, end exclusive. */
export function neededWindows(script: TransitionScript): { ref: SourceRef; from: number; to: number }[] {
  const merged = new Map<string, { ref: SourceRef; from: number; to: number }>();
  for (const window of partWindows(script)) {
    const key = JSON.stringify([window.ref.song, window.ref.role, window.ref.stem, window.ref.start, window.ref.duration]);
    const kept = merged.get(key);
    if (kept) {
      kept.from = Math.min(kept.from, window.from);
      kept.to = Math.max(kept.to, window.to);
    } else merged.set(key, { ...window });
  }
  return [...merged.values()];
}

function partWindows(script: TransitionScript): { ref: SourceRef; from: number; to: number }[] {
  const count = intRound(script.duration * SAMPLE_RATE);
  return [script.a, script.b, ...script.extras].map((part) => {
    const warp = heardWarp(part);
    if (warp.isIdentity) {
      const begin = Math.max(0, intRound((warp.source[0] - part.windowOrigin) * SAMPLE_RATE));
      const span = Math.min(count - intRound(warp.output[0] * SAMPLE_RATE), intRound((warp.output[warp.output.length - 1] - warp.output[0]) * SAMPLE_RATE));
      return { ref: part.source, from: begin, to: begin + Math.max(0, span) };
    }
    const first = intRound((warp.source[0] - 0.5 - part.windowOrigin) * SAMPLE_RATE);
    const last = intRound((warp.source[warp.source.length - 1] + 0.5 - part.windowOrigin) * SAMPLE_RATE);
    return { ref: part.source, from: Math.max(0, first), to: Math.max(0, last) };
  });
}
