import type { SongDetail } from '../../api';
import { bytesToDb, type BeatGrid, type FrameInput } from './features';

/** The player's read-only side taps (player.ts getVisualTaps): unsmoothed left and right analysers. */
export type VisualTaps = { left: AnalyserNode; right: AnalyserNode };
type Readable = {
  getSpectrum(): Uint8Array | null;
  getVisualTaps?: () => VisualTaps | null;
  state?: { songTime?: number };
};

/** The analysed grid of the song on screen, when it has one. */
export function gridOf(detail: SongDetail | null | undefined): BeatGrid | null {
  if (!detail) return null;
  return {
    beats: detail.beat_times ?? [],
    bars: detail.bar_times ?? [],
    sections: (detail.sections ?? []).map((section) => section.start).sort((a, b) => a - b),
    beatsPerBar: detail.beats_per_bar ?? 4,
  };
}

/** Reads one frame of measurements through the player's existing API. Prefers the unsmoothed stereo
 * taps; falls back to the mixed spectrum alone (no waveform, no width) when the taps are missing. */
export function createFrameSource(player: Readable) {
  let db: Float32Array | null = null;
  let leftDb: Float32Array | null = null;
  let rightDb: Float32Array | null = null;
  let left: Float32Array<ArrayBuffer> | null = null;
  let right: Float32Array<ArrayBuffer> | null = null;
  let seenSongTime: number | null = null;
  let seenAt = 0;

  /** The player publishes its clock every 50 ms; between ticks the visualizer runs it forward. */
  function songTime(now: number): number | null {
    const time = player.state?.songTime;
    if (typeof time !== 'number' || !Number.isFinite(time)) return null;
    if (time !== seenSongTime) { seenSongTime = time; seenAt = now; }
    return time + Math.min(0.12, Math.max(0, (now - seenAt) / 1000));
  }

  function read(now: number, grid: BeatGrid | null): FrameInput | null {
    const taps = player.getVisualTaps?.() ?? null;
    if (taps) {
      const bins = taps.left.frequencyBinCount;
      if (!leftDb || leftDb.length !== bins) {
        leftDb = new Float32Array(bins); rightDb = new Float32Array(bins); db = new Float32Array(bins);
        left = new Float32Array(taps.left.fftSize); right = new Float32Array(taps.right.fftSize);
      }
      taps.left.getFloatFrequencyData(leftDb as Float32Array<ArrayBuffer>);
      taps.right.getFloatFrequencyData(rightDb as Float32Array<ArrayBuffer>);
      taps.left.getFloatTimeDomainData(left!);
      taps.right.getFloatTimeDomainData(right!);
      for (let index = 0; index < bins; index += 1) {
        const a = Number.isFinite(leftDb[index]) ? 10 ** (leftDb[index] / 10) : 0;
        const b = Number.isFinite(rightDb![index]) ? 10 ** (rightDb![index] / 10) : 0;
        db![index] = Math.max(-120, 10 * Math.log10((a + b) / 2 + 1e-14));
      }
      return { now, db, sampleRate: taps.left.context.sampleRate, left, right, songTime: songTime(now), grid };
    }
    const spectrum = player.getSpectrum();
    if (!spectrum || spectrum.length === 0) return null;
    db = bytesToDb(spectrum, db ?? undefined);
    return { now, db, sampleRate: 44100, songTime: songTime(now), grid };
  }

  return { read };
}
