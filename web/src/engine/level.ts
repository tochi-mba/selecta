import { analyseInWorker, spawnAnalysisWorker } from '../dsp/workers/spawn';

/** The level each song plays at in a browser mix (cloud.seam_lead, ADR-0479 phase 1).
 *
 * Local mode plays every song at one loudness: `SongInfo.gain_db` is
 * `min(-14 LUFS - the song's loudness, -1 dB - its peak)` (src/selecta/analysis/song.py), so a
 * quiet song is raised only as far as its own peak allows. The browser player had no such gain,
 * so songs stepped in level at every transition. This measures the decoded song once, off the
 * page thread (BS.1770 integrated loudness and sample peak, dsp/loudness.ts), and answers with
 * the same gain as a linear factor.
 *
 * It is the lightweight measurement of this device's own decode, under its own id, and is never
 * presented as the Python engine's number (ADR-0459). A song that cannot be measured plays at 1.
 */

export const LEVEL_IMPLEMENTATION = 'song-level-bs1770-samplepeak-v1';
/** `TARGET_LUFS` and `PEAK_CEILING_DB` in src/selecta/analysis/song.py. */
export const TARGET_LUFS = -14;
export const PEAK_CEILING_DB = -1;
/** A measurement that takes longer than this is given up on; the song plays at 1. */
export const LEVEL_TIMEOUT_MS = 20_000;

/** Local mode's gain rule, in decibels; 0 when the song has no measurable loudness. */
export function gainDb(lufs: number, peakDb: number): number {
  if (!Number.isFinite(lufs) || !Number.isFinite(peakDb)) return 0;
  return Math.min(TARGET_LUFS - lufs, PEAK_CEILING_DB - peakDb);
}

export const linear = (db: number): number => 10 ** (db / 20);

export type Measure = (channels: Float32Array[], sampleRate: number) => Promise<{ lufs?: number; peakDb?: number }>;

export type Levels = {
  /** The linear gain for this decoded song; measured once per buffer. Never rejects. */
  of(buffer: AudioBuffer): Promise<number>;
  dispose(): void;
};

/** Levels measured in the analysis worker. `measure` is injectable for tests. */
export function createLevels(measure?: Measure): Levels {
  const known = new WeakMap<AudioBuffer, Promise<number>>();
  let worker: Worker | null = null;
  let disposed = false;
  const inWorker: Measure = async (channels, sampleRate) => {
    worker ??= spawnAnalysisWorker();
    try {
      return await analyseInWorker(worker, new Float32Array(0), sampleRate, ['loudness'], {
        owned: true, timeoutMs: LEVEL_TIMEOUT_MS, channels,
      });
    } catch (problem) {
      // a stuck worker is replaced, so one slow song never costs the next its measurement
      worker?.terminate();
      worker = null;
      throw problem;
    }
  };
  const run = measure ?? inWorker;
  return {
    of(buffer) {
      if (disposed) return Promise.resolve(1);
      let found = known.get(buffer);
      if (!found) {
        found = (async () => {
          try {
            // copies: a playing AudioBuffer's own channel data must never be moved to a worker
            const channels: Float32Array[] = [];
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) channels.push(buffer.getChannelData(channel).slice());
            const measured = await run(channels, buffer.sampleRate);
            return linear(gainDb(measured.lufs ?? NaN, measured.peakDb ?? NaN));
          } catch {
            return 1;
          }
        })();
        known.set(buffer, found);
      }
      return found;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
    },
  };
}
