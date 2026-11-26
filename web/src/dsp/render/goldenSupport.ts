/** What the device-render golden tests share: the synthetic songs as sources, the stored signal
 * summaries decoded, and the perceptual measures two renders are compared by when their samples
 * cannot be (tools/device_render_golden.py writes the fixtures; docs/engineering/device-render.md).
 * Nothing here reads or makes real music. */

import { integratedLoudness } from '../loudness';
import { renderSong, type SynthEvent, type SynthSong } from '../analysis/synth';
import type { SourceProvider } from './engine';
import { monoOf, transientEnvelope, ENV_HOP_TIME } from './envelope';
import { type Channels, filtfilt, HIGH_SPLIT_HZ, LOW_SPLIT_HZ, lowpassSection } from './filters';
import { f32, roundHalfEven } from './npy';
import { truePeakDb } from './peakLimit';
import { SAMPLE_RATE, type SourceRef } from './script';

export type GoldenSong = SynthSong & { id: number; bpm: number; beats: number[] };

export interface SignalSummary {
  length: number;
  stride: number;
  probe: [string, string];
  windows: { at: number; values: [string, string] }[];
  block: number;
  rms: [string, string];
  peak: [string, string];
  sha256: string;
}

export interface Perceptual {
  lufs?: number;
  lufs_playback_meter: number;
  true_peak_db: number;
  band_db: { low: number[]; mid: number[]; high: number[] };
  onsets: number[];
}

/** Little-endian float32 values from base64. */
export function decodeF32(text: string): Float32Array {
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

/** Which stem a synthetic event belongs to, as the generator decides: hits are drums, a tone
 * with three harmonics is the bass line, any other tone is the pad. */
export function stemOf(event: SynthEvent): 'drums' | 'bass' | 'other' {
  if (event.kind === 'kick' || event.kind === 'snare' || event.kind === 'hat') return 'drums';
  return (event.harmonics ?? []).length === 3 ? 'bass' : 'other';
}

/** The synthetic songs as a renderer's sources: a song's mix, or a stem window of it. */
export function goldenProvider(songs: GoldenSong[]): SourceProvider {
  const rendered = new Map<string, Channels>();
  const full = (song: GoldenSong, stem: string): Channels => {
    const key = `${song.id}:${stem}`;
    let audio = rendered.get(key);
    if (!audio) {
      const events = stem === 'mix' || stem === 'band' ? song.events : song.events.filter((event) => stem !== 'vocals' && stemOf(event) === stem);
      audio = renderSong({ ...song, events });
      rendered.set(key, audio);
    }
    return audio;
  };
  return {
    samples(ref: SourceRef) {
      const song = songs.find((entry) => entry.id === ref.song);
      if (!song) throw new Error(`no synthetic song ${String(ref.song)}`);
      if (ref.role === 'mix') return { channels: full(song, 'mix'), sampleRate: SAMPLE_RATE };
      const audio = full(song, ref.stem as string);
      const first = roundHalfEven(ref.start * SAMPLE_RATE);
      const last = Math.min(roundHalfEven((ref.start + ref.duration) * SAMPLE_RATE), audio[0].length);
      return { channels: audio.map((channel) => channel.slice(first, last)), sampleRate: SAMPLE_RATE };
    },
  };
}

export interface SummaryDifference {
  lengthMatches: boolean;
  /** Largest absolute difference over the stored samples and windows. */
  samples: number;
  /** Largest difference of block RMS and block peak. */
  blocks: number;
}

/** How far a port signal is from a stored summary of Python's. */
export function compareSummary(audio: Channels, summary: SignalSummary): SummaryDifference {
  let samples = 0;
  let blocks = 0;
  for (let c = 0; c < 2; c += 1) {
    const probe = decodeF32(summary.probe[c]);
    for (let k = 0; k < probe.length; k += 1) {
      const port = audio[c][Math.floor(summary.stride / 2) + k * summary.stride];
      samples = Math.max(samples, port === undefined ? Infinity : Math.abs(port - probe[k]));
    }
    for (const window of summary.windows) {
      const values = decodeF32(window.values[c]);
      for (let k = 0; k < values.length; k += 1) {
        const port = audio[c][window.at + k];
        samples = Math.max(samples, port === undefined ? Infinity : Math.abs(port - values[k]));
      }
    }
    const rms = decodeF32(summary.rms[c]);
    const peak = decodeF32(summary.peak[c]);
    for (let block = 0; block < rms.length; block += 1) {
      let energy = 0;
      let largest = 0;
      for (let k = 0; k < summary.block; k += 1) {
        const value = audio[c][block * summary.block + k] ?? 0;
        energy += value * value;
        largest = Math.max(largest, Math.abs(value));
      }
      blocks = Math.max(blocks, Math.abs(Math.sqrt(energy / summary.block) - rms[block]), Math.abs(largest - peak[block]));
    }
  }
  return { lengthMatches: audio[0].length === summary.length, samples, blocks };
}

function levels(signal: Float32Array): number[] {
  const block = Math.floor(SAMPLE_RATE / 2);
  const out: number[] = [];
  for (let first = 0; first + block <= signal.length; first += block) {
    let energy = 0;
    for (let k = 0; k < block; k += 1) energy += signal[first + k] * signal[first + k];
    out.push(20 * Math.log10(Math.max(Math.sqrt(energy / block), 1e-6)));
  }
  return out;
}

/** The generator's `perceptual`: loudness, band levels in half-second blocks, onset times. */
export function perceptualMeasures(audio: Channels): Perceptual {
  const mono = monoOf(audio);
  const low = filtfilt(lowpassSection(LOW_SPLIT_HZ), mono, new Float32Array(mono.length));
  const below = filtfilt(lowpassSection(HIGH_SPLIT_HZ), mono, new Float32Array(mono.length));
  const high = Float32Array.from(mono, (value, k) => f32(value - below[k]));
  const mid = Float32Array.from(mono, (value, k) => f32(f32(value - low[k]) - high[k]));
  const env = transientEnvelope(mono);
  let top = 0;
  for (const value of env) top = Math.max(top, value);
  const floor = 0.3 * top;
  const peaks: number[] = [];
  for (let k = 1; k < env.length - 1; k += 1) if (env[k] >= floor && env[k] >= env[k - 1] && env[k] > env[k + 1]) peaks.push(k);
  peaks.sort((x, y) => env[y] - env[x] || x - y);
  const kept: number[] = [];
  for (const k of peaks) if (kept.every((other) => Math.abs(k - other) > 20)) kept.push(k);
  kept.sort((x, y) => x - y);
  return {
    lufs_playback_meter: integratedLoudness(audio, SAMPLE_RATE),
    true_peak_db: truePeakDb(audio),
    band_db: { low: levels(low), mid: levels(mid), high: levels(high) },
    onsets: kept.map((k) => Math.round(k * ENV_HOP_TIME * 1e6) / 1e6),
  };
}

/** For each reference onset, the nearest port onset: the share within `withinMs`, and the worst
 * distance among those matched. */
export function onsetAgreement(reference: number[], port: number[], withinMs = 10): { share: number; worstMs: number } {
  let matched = 0;
  let worst = 0;
  for (const time of reference) {
    let nearest = Infinity;
    for (const other of port) nearest = Math.min(nearest, Math.abs(other - time));
    if (nearest * 1000 <= withinMs) {
      matched += 1;
      worst = Math.max(worst, nearest * 1000);
    }
  }
  return { share: reference.length ? matched / reference.length : 1, worstMs: worst };
}
