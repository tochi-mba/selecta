/** A whole song's facts, measured in the browser the way the Desktop measures them
 * (`analysis/pipeline.py::analyse_audio` and what `analyse_song` stores). Device studio,
 * ADR-0479 phase 5; the recipe and its measured agreement are docs/engineering/device-analysis.md.
 *
 * The steps, as in Python: fold to mono, resample to 22,050 Hz, take the onset envelope, build
 * the beat grid from the beat source's beats, extract the bar features, key the averaged chroma,
 * and measure loudness and peak on the song as decoded. The result is the analysis row (rounded
 * as Python rounds it) and the named arrays, each in the type the account accepts them in.
 *
 * Pure: no DOM, no Web Audio, nothing sent anywhere. Runs in the analysis worker.
 */

import type { BeatEstimate, BeatSource } from './beatSource';
import { DEVICE_ANALYSIS_IMPLEMENTATION, PYTHON_ANALYSIS_VERSION } from './deviceAnalysisIds';
import { extractFeatures, FEATURE_SR, frameFeatures, type FrameFeatures, type SongFeatures } from './features';
import { barTimes, buildGrid, type BeatGrid } from './grid';
import { roundHalfEven, pyRound } from './numeric';
import { onsetEnvelope } from './onsetEnvelope';
import { resample } from './resample';
import type { Section } from './sections';
import { camelotOfKey, CHROMA_KEY_CONFIDENCE, chromaKey } from './songKey';
import { pyloudnormIntegrated, samplePeakDecibels } from './songLoudness';

export { DEVICE_ANALYSIS_IMPLEMENTATION, PYTHON_ANALYSIS_VERSION };
/** Bins in the whole-song waveform strip (`features.PEAK_BINS`). */
export const PEAK_BINS = 1600;

/** The `analysis` row, as `pipeline.analyse_song` writes it, the key being the chroma key. */
export interface AnalysisRow {
  bpm: number;
  constant_tempo: 0 | 1;
  grid_confidence: number;
  beats_per_bar: number;
  key: string;
  camelot: string;
  key_confidence: number;
  key_agrees_chroma: 0 | 1;
  lufs: number;
  peak_db: number;
  energy: number;
  sections: Section[];
  timbre: number[];
}

/** The named arrays. The planner reads the first seven (`song.SONG_ARRAYS`), in the account's
 * wire types; the raw beats and the waveform stay on this device. */
export interface SongArrays {
  beats: Float64Array;
  bar_starts: Int32Array;
  energy_bars: Float32Array;
  low_share_bars: Float32Array;
  rms_db_bars: Float32Array;
  /** bars x 12, row-major. */
  chroma_bars: Float32Array;
  /** bars x 20, row-major. */
  mfcc_bars: Float32Array;
  raw_beats: Float32Array;
  raw_downbeats: Float32Array;
  peaks: Uint8Array;
}

export interface SongFacts {
  implementation: string;
  analysis_version: number;
  /** Which beat source gave the beats, and how much it trusted them. */
  beat_source: string;
  beat_confidence: number;
  sample_rate: number;
  duration_s: number;
  /** Null, with `error`, when there is no steady beat (Python stores the same error). */
  row: AnalysisRow | null;
  arrays: SongArrays | null;
  error?: string;
}

/** What a stage test needs beside the facts; never stored. */
export interface SongDetail {
  mono22k: Float32Array;
  envelope: Float32Array;
  grid: BeatGrid | null;
  features: SongFeatures | null;
  /** The frame-level values the bar features were averaged from. */
  frames: FrameFeatures | null;
  lufs: number;
  peakDb: number;
}

/** `audio.to_mono`: the channels' mean, summed in float32 as numpy sums them. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum = Math.fround(sum + channel[index]);
    mono[index] = sum / channels.length;
  }
  return mono;
}

/** `features.waveform_peaks`: the RMS of 1600 equal slices, scaled to 0..255. */
export function waveformPeaks(mono: Float32Array, bins = PEAK_BINS): Uint8Array {
  const step = Math.max(1, Math.floor(mono.length / bins));
  const usable = mono.length >= step * bins ? step * bins : mono.length;
  const count = Math.floor(usable / step);
  const rms = new Float32Array(count);
  let top = 0;
  for (let slice = 0; slice < count; slice += 1) {
    let squares = 0;
    for (let k = slice * step; k < (slice + 1) * step; k += 1) squares += Math.fround(mono[k] * mono[k]);
    rms[slice] = Math.sqrt(Math.fround(squares / step));
    top = Math.max(top, rms[slice]);
  }
  const scale = top || 1;
  return Uint8Array.from(rms, (value) => roundHalfEven(Math.fround(Math.fround(value / scale) * 255)));
}

/** Mono at the input rate and at the feature rate, made once and shared by every step. */
export function prepareSignal(channels: Float32Array[], sampleRate: number): { mono: Float32Array; mono22k: Float32Array } {
  const mono = toMono(channels);
  return { mono, mono22k: sampleRate === FEATURE_SR ? mono : resample(mono, sampleRate, FEATURE_SR) };
}

/** Measure a song from its channels and the beats a beat source gave for it. */
export function analyseSong(
  channels: Float32Array[],
  sampleRate: number,
  beats: BeatEstimate,
  prepared = prepareSignal(channels, sampleRate),
  envelope = onsetEnvelope(prepared.mono22k),
): { facts: SongFacts; detail: SongDetail } {
  const duration = channels[0].length / sampleRate;
  const lufs = pyloudnormIntegrated(channels, sampleRate);
  const peakDb = samplePeakDecibels(channels);
  const base = {
    implementation: DEVICE_ANALYSIS_IMPLEMENTATION,
    analysis_version: PYTHON_ANALYSIS_VERSION,
    beat_source: beats.implementation,
    beat_confidence: beats.confidence,
    sample_rate: sampleRate,
    duration_s: duration,
  };
  const detail: SongDetail = { mono22k: prepared.mono22k, envelope, grid: null, features: null, frames: null, lufs, peakDb };
  const grid = buildGrid(beats.beats, beats.downbeats, envelope);
  if (!grid || grid.barStarts.length < 4) {
    return { facts: { ...base, row: null, arrays: null, error: 'no steady beat found' }, detail };
  }
  const frames = frameFeatures(prepared.mono22k);
  const features = extractFeatures(prepared.mono22k, barTimes(grid), duration, frames);
  detail.grid = grid;
  detail.features = features;
  detail.frames = frames;
  const key = chromaKey(features.chromaProfile);
  const row: AnalysisRow = {
    bpm: pyRound(grid.bpm, 2),
    constant_tempo: grid.constantTempo ? 1 : 0,
    grid_confidence: pyRound(grid.confidence, 3),
    beats_per_bar: grid.beatsPerBar,
    key,
    camelot: camelotOfKey(key),
    key_confidence: CHROMA_KEY_CONFIDENCE,
    key_agrees_chroma: 1,
    lufs: pyRound(lufs, 2),
    peak_db: pyRound(peakDb, 2),
    energy: pyRound(features.energy, 3),
    sections: features.sections,
    timbre: Array.from(features.timbre, (value) => pyRound(value, 3)),
  };
  const arrays: SongArrays = {
    beats: grid.beats,
    bar_starts: grid.barStarts,
    energy_bars: Float32Array.from(features.energyBars),
    low_share_bars: Float32Array.from(features.lowShareBars),
    rms_db_bars: Float32Array.from(features.rmsDbBars),
    chroma_bars: Float32Array.from(features.chromaBars),
    mfcc_bars: Float32Array.from(features.mfccBars),
    raw_beats: Float32Array.from(grid.rawBeats),
    raw_downbeats: Float32Array.from(grid.rawDownbeats),
    peaks: waveformPeaks(prepared.mono),
  };
  return { facts: { ...base, row, arrays }, detail };
}

/** Measure a song with a beat source: the source hears the 22,050 Hz mono and reuses the onset
 * envelope the grid is refined against, so the expensive steps run once. */
export function measureSong(channels: Float32Array[], sampleRate: number, source: BeatSource): { facts: SongFacts; detail: SongDetail } {
  const prepared = prepareSignal(channels, sampleRate);
  const envelope = onsetEnvelope(prepared.mono22k);
  const beats = source.beats(prepared.mono22k, FEATURE_SR, { onsetEnvelope: envelope });
  return analyseSong(channels, sampleRate, beats, prepared, envelope);
}

