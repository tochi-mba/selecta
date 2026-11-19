/** The golden comparison harness, JS side (ADR-0459 "parity is measured, not asserted").
 *
 * Loads a golden set produced by `tools/bf_golden.py` (expected values from the Python
 * engine over synthetic owned audio), runs the real JS implementations in this directory,
 * and emits one row per metric: {name, metric, expected, actual, delta, pass}. Tolerances are
 * arguments, never constants, so a run always says what bar it was held to.
 *
 * No mocking tripwire: `runGoldenSet` synthesises or decodes actual PCM and calls the actual
 * DSP (`integratedLoudness`, `truePeakDb`, `detectOnsets` + `estimateTempo`, `estimateKey`,
 * `scheduleSeam`). There is no code path that copies an expected value into `actual`.
 *
 * Fixtures prefer `synthSpec`, a deterministic recipe both the Python generator and this file
 * implement with the same formulas, so the JSON stays small. `pcmBase64` carries raw
 * little-endian float32 mono PCM when a recipe will not do.
 */

import { estimateKey } from './analysis/key';
import { detectOnsets } from './analysis/onsets';
import { estimateTempo } from './analysis/tempo';
import { integratedLoudness, truePeakDb } from './loudness';
import { fft } from './fft';
import { scheduleSeam, type SeamSpec, type TrackTiming } from './seams';
import { timeStretch } from './stretch';

export const GOLDEN_IMPLEMENTATION = 'golden-harness-v1';

// --- Synthesis spec: the shared contract with tools/bf_golden.py ------------------------------

export interface ToneElement {
  type: 'tone';
  freqHz: number;
  amplitude: number;
  startS?: number;
  durS: number;
}

export interface ToneStackElement {
  type: 'toneStack';
  freqsHz: number[];
  amplitude: number;
  startS?: number;
  durS: number;
}

export interface ClicksElement {
  type: 'clicks';
  bpm: number;
  startS?: number;
  durS: number;
  amplitude?: number;
  clickFreqHz?: number;
  clickMs?: number;
}

export type SynthElement = ToneElement | ToneStackElement | ClicksElement;

export interface GoldenSeamCase {
  a: TrackTiming;
  b: TrackTiming;
  spec: SeamSpec;
}

export interface GoldenExpected {
  lufs?: number;
  truePeakDb?: number;
  tempoBpm?: number;
  tempoAmbiguous?: boolean;
  key?: string;
  mode?: 'major' | 'minor';
  seamStartSeconds?: number;
  seamKind?: 'beatmatch' | 'fade';
}

export interface GoldenFixture {
  name: string;
  sampleRate: number;
  durationS: number;
  /** 1 (mono) or 2 (the mono synth duplicated). Default 2, matching the Python generator. */
  channels?: 1 | 2;
  synthSpec?: SynthElement[];
  /** Raw little-endian float32 mono PCM, base64. Used only when synthSpec is absent. */
  pcmBase64?: string;
  seamCase?: GoldenSeamCase;
  expected: GoldenExpected;
}

export interface GoldenSet {
  fixtures: GoldenFixture[];
}

export interface GoldenTolerances {
  lufs: number;
  truePeakDb: number;
  tempoBpm: number;
  seamSeconds: number;
}

export interface GoldenRow {
  name: string;
  metric: string;
  expected: number | string | boolean;
  actual: number | string | boolean;
  delta: number;
  pass: boolean;
}

/** Deterministic synthesis: identical formulas to `synthesize` in tools/bf_golden.py. */
export function synthesize(
  spec: SynthElement[],
  sampleRate: number,
  durationS: number
): Float32Array {
  const output = new Float32Array(Math.round(durationS * sampleRate));
  const addTone = (freqHz: number, amplitude: number, startS: number, durS: number) => {
    const first = Math.round(startS * sampleRate);
    const count = Math.round(durS * sampleRate);
    for (let index = 0; index < count && first + index < output.length; index += 1) {
      output[first + index] += amplitude * Math.sin((2 * Math.PI * freqHz * index) / sampleRate);
    }
  };
  for (const element of spec) {
    const startS = element.startS ?? 0;
    if (element.type === 'tone') {
      addTone(element.freqHz, element.amplitude, startS, element.durS);
    } else if (element.type === 'toneStack') {
      for (const freqHz of element.freqsHz) {
        addTone(freqHz, element.amplitude, startS, element.durS);
      }
    } else {
      const amplitude = element.amplitude ?? 0.8;
      const clickFreqHz = element.clickFreqHz ?? 1000;
      const clickMs = element.clickMs ?? 10;
      const burst = Math.max(2, Math.round((clickMs / 1000) * sampleRate));
      const period = 60 / element.bpm;
      for (let click = 0; ; click += 1) {
        const at = startS + click * period;
        if (at >= startS + element.durS) {
          break;
        }
        const first = Math.round(at * sampleRate);
        for (let index = 0; index < burst && first + index < output.length; index += 1) {
          const hann = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (burst - 1)));
          output[first + index] +=
            amplitude * hann * Math.sin((2 * Math.PI * clickFreqHz * index) / sampleRate);
        }
      }
    }
  }
  return output;
}

/** Decode base64 little-endian float32 mono PCM without any DOM dependency. */
export function decodePcmBase64(encoded: string): Float32Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = encoded.replace(/[=\s]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteAt = 0;
  for (let at = 0; at + 1 < clean.length; at += 4) {
    const chunk = [0, 1, 2, 3].map((offset) =>
      at + offset < clean.length ? alphabet.indexOf(clean[at + offset]) : 0
    );
    const bits = (chunk[0] << 18) | (chunk[1] << 12) | (chunk[2] << 6) | chunk[3];
    if (byteAt < bytes.length) bytes[byteAt++] = (bits >> 16) & 0xff;
    if (at + 2 < clean.length && byteAt < bytes.length) bytes[byteAt++] = (bits >> 8) & 0xff;
    if (at + 3 < clean.length && byteAt < bytes.length) bytes[byteAt++] = bits & 0xff;
  }
  return new Float32Array(bytes.buffer, 0, Math.floor(byteAt / 4));
}

/** The fixture's channels, synthesised or decoded. */
export function fixtureChannels(fixture: GoldenFixture): Float32Array[] {
  const mono = fixture.synthSpec
    ? synthesize(fixture.synthSpec, fixture.sampleRate, fixture.durationS)
    : fixture.pcmBase64
      ? decodePcmBase64(fixture.pcmBase64)
      : new Float32Array(0);
  return (fixture.channels ?? 2) === 2 ? [mono, mono.slice()] : [mono];
}

function numberRow(
  name: string,
  metric: string,
  expected: number,
  actual: number,
  tolerance: number
): GoldenRow {
  const delta = actual - expected;
  return { name, metric, expected, actual, delta, pass: Math.abs(delta) <= tolerance };
}

function exactRow(
  name: string,
  metric: string,
  expected: string | boolean,
  actual: string | boolean
): GoldenRow {
  return { name, metric, expected, actual, delta: expected === actual ? 0 : NaN, pass: expected === actual };
}

/** Run every fixture's metrics against the real JS DSP. Tolerances are the caller's. */
export function runGoldenSet(set: GoldenSet, tolerances: GoldenTolerances): GoldenRow[] {
  const rows: GoldenRow[] = [];
  for (const fixture of set.fixtures) {
    const { name, expected } = fixture;
    const needsAudio =
      expected.lufs !== undefined ||
      expected.truePeakDb !== undefined ||
      expected.tempoBpm !== undefined ||
      expected.tempoAmbiguous !== undefined ||
      expected.key !== undefined;
    const channels = needsAudio ? fixtureChannels(fixture) : [];
    if (expected.lufs !== undefined) {
      const actual = integratedLoudness(channels, fixture.sampleRate);
      rows.push(numberRow(name, 'lufs', expected.lufs, actual, tolerances.lufs));
    }
    if (expected.truePeakDb !== undefined) {
      const actual = truePeakDb(channels);
      rows.push(numberRow(name, 'truePeakDb', expected.truePeakDb, actual, tolerances.truePeakDb));
    }
    if (expected.tempoBpm !== undefined || expected.tempoAmbiguous !== undefined) {
      const tempo = estimateTempo(detectOnsets(channels[0], fixture.sampleRate));
      if (expected.tempoBpm !== undefined) {
        rows.push(numberRow(name, 'tempoBpm', expected.tempoBpm, tempo.bpm, tolerances.tempoBpm));
      }
      if (expected.tempoAmbiguous !== undefined) {
        rows.push(exactRow(name, 'tempoAmbiguous', expected.tempoAmbiguous, tempo.ambiguous));
      }
    }
    if (expected.key !== undefined) {
      const key = estimateKey(channels[0], fixture.sampleRate);
      rows.push(exactRow(name, 'key', expected.key, key.key));
      if (expected.mode !== undefined) {
        rows.push(exactRow(name, 'mode', expected.mode, key.mode));
      }
    }
    if (fixture.seamCase && (expected.seamStartSeconds !== undefined || expected.seamKind)) {
      const schedule = scheduleSeam(fixture.seamCase.a, fixture.seamCase.b, fixture.seamCase.spec);
      if (expected.seamKind !== undefined) {
        rows.push(exactRow(name, 'seamKind', expected.seamKind, schedule.kind));
      }
      if (expected.seamStartSeconds !== undefined) {
        rows.push(
          numberRow(
            name,
            'seamStartSeconds',
            expected.seamStartSeconds,
            schedule.startSeconds,
            tolerances.seamSeconds
          )
        );
      }
    }
  }
  return rows;
}

/** Parse and lightly validate a golden set loaded from JSON. */
export function loadGoldenSet(json: string): GoldenSet {
  const parsed = JSON.parse(json) as GoldenSet;
  if (!parsed || !Array.isArray(parsed.fixtures)) {
    throw new Error('A golden set needs a fixtures array.');
  }
  for (const fixture of parsed.fixtures) {
    if (!fixture.name || !(fixture.sampleRate > 0) || !(fixture.durationS > 0)) {
      throw new Error(`Fixture '${fixture?.name ?? '?'}' is missing name, sampleRate or durationS.`);
    }
  }
  return parsed;
}

// --- Stretch: the browser WSOLA against the Python engine's stretch ---------------------------
//
// The Python engine stretches with pedalboard's Rubber Band (src/selecta/render/dsp.py
// stretch_to_warp), so a sample-exact match is neither expected nor wanted. What must match is
// what a listener hears: the length, where each hit lands, the pitch, and how sharp hits stay.
// The measurements below are the same formulas the reference was measured with.

/** One stretch the Python engine ran over the shared synth (a 120 BPM click track for timing
 * and smearing, a 220 Hz tone for pitch, both 8 s at 44.1 kHz), and what it measured. */
export interface StretchReference {
  ratio: number;
  inputFrames: number;
  lengthFrames: number;
  onsetsS: number[];
  spreadMs: number;
  dominantHz: number;
}

export interface StretchTolerances {
  /** How far each hit may land from the Python engine's, in ms. */
  onsetMs: number;
  /** How far the dominant pitch may sit from the Python engine's, as a share (0.005 = 0.5%). */
  pitchShare: number;
  /** How much wider than the Python engine's a hit may smear, in ms. */
  spreadMs: number;
}

export const STRETCH_CLICKS: SynthElement[] = [{ type: 'clicks', bpm: 120, durS: 8, amplitude: 0.8 }];
export const STRETCH_TONE: SynthElement[] = [{ type: 'tone', freqHz: 220, amplitude: 0.3, durS: 8 }];

function envelopeMs(signal: Float32Array, sampleRate: number): Float32Array {
  const width = Math.floor(sampleRate / 1000);
  const out = new Float32Array(Math.floor(signal.length / width));
  for (let block = 0; block < out.length; block += 1) {
    let sum = 0;
    for (let index = block * width; index < (block + 1) * width; index += 1) sum += signal[index] * signal[index];
    out[block] = Math.sqrt(sum / width);
  }
  return out;
}

/** Each hit: the strongest 1 ms block in every 250 ms run above 5 percent of the loudest, then
 * the first block in the 30 ms before it that reaches half that peak. */
export function stretchOnsets(signal: Float32Array, sampleRate: number): number[] {
  const env = envelopeMs(signal, sampleRate);
  let loudest = 0;
  for (const value of env) loudest = Math.max(loudest, value);
  const out: number[] = [];
  let ms = 0;
  while (ms < env.length) {
    if (env[ms] < 0.05 * loudest) {
      ms += 1;
      continue;
    }
    let top = ms;
    for (let at = ms; at < Math.min(env.length, ms + 250); at += 1) if (env[at] > env[top]) top = at;
    let first = Math.max(0, top - 30);
    while (env[first] < 0.5 * env[top]) first += 1;
    out.push(first / 1000);
    ms = top + 250;
  }
  return out;
}

/** The widest hit: 1 ms blocks above a tenth of the hit's own peak, from 5 ms before its onset. */
export function stretchSpreadMs(signal: Float32Array, sampleRate: number, onsets: number[]): number {
  const env = envelopeMs(signal, sampleRate);
  let worst = 0;
  for (const onset of onsets) {
    const from = Math.max(0, Math.round(onset * 1000) - 5);
    const to = Math.min(env.length, Math.round(onset * 1000) - 5 + 120);
    let peak = 0;
    for (let ms = from; ms < to; ms += 1) peak = Math.max(peak, env[ms]);
    let wide = 0;
    for (let ms = from; ms < to; ms += 1) if (env[ms] > 0.1 * peak) wide += 1;
    worst = Math.max(worst, wide);
  }
  return worst;
}

/** The dominant frequency of the middle 16384 samples: Hann window, FFT, parabolic peak. */
export function dominantHz(signal: Float32Array, sampleRate: number): number {
  const size = 16384;
  const start = Math.floor((signal.length - size) / 2);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let index = 0; index < size; index += 1) real[index] = signal[start + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size));
  fft(real, imag);
  const magnitude = (bin: number) => Math.hypot(real[bin], imag[bin]);
  let peak = 1;
  for (let bin = 2; bin < size / 2 - 1; bin += 1) if (magnitude(bin) > magnitude(peak)) peak = bin;
  const [a, b, c] = [Math.log(magnitude(peak - 1)), Math.log(magnitude(peak)), Math.log(magnitude(peak + 1))];
  return ((peak + (0.5 * (a - c)) / (a - 2 * b + c)) * sampleRate) / size;
}

/** Stretch the shared synth with the browser's WSOLA and compare it with the Python engine's
 * stretch of the same audio, one row per measurement. */
export function compareStretch(reference: StretchReference, tolerances: StretchTolerances, sampleRate = 44100): GoldenRow[] {
  const name = `stretch-${reference.ratio}`;
  const clicks = synthesize(STRETCH_CLICKS, sampleRate, 8);
  const tone = synthesize(STRETCH_TONE, sampleRate, 8);
  const stretched = timeStretch([clicks, clicks.slice()], sampleRate, reference.ratio);
  const pitched = timeStretch([tone], sampleRate, reference.ratio);
  if (stretched.status !== 'ready' || pitched.status !== 'ready') {
    return [exactRow(name, 'stretched', 'ready', stretched.status === 'ready' ? pitched.status : stretched.status)];
  }
  const out = stretched.channels[0];
  const onsets = stretchOnsets(out, sampleRate);
  const rows: GoldenRow[] = [
    exactRow(name, 'inputFrames', String(reference.inputFrames), String(clicks.length)),
    numberRow(name, 'lengthFrames', reference.lengthFrames, out.length, 0),
    numberRow(name, 'onsetCount', reference.onsetsS.length, onsets.length, 0),
  ];
  if (onsets.length === reference.onsetsS.length) {
    const deltas = onsets.map((onset, index) => Math.abs(onset - reference.onsetsS[index]) * 1000);
    rows.push(numberRow(name, 'worstOnsetMs', 0, Math.max(...deltas), tolerances.onsetMs));
  }
  const pitch = dominantHz(pitched.channels[0], sampleRate);
  rows.push(numberRow(name, 'dominantHz', reference.dominantHz, pitch, reference.dominantHz * tolerances.pitchShare));
  const spread = stretchSpreadMs(out, sampleRate, onsets);
  rows.push({ name, metric: 'spreadMs', expected: reference.spreadMs, actual: spread, delta: spread - reference.spreadMs, pass: spread <= reference.spreadMs + tolerances.spreadMs });
  return rows;
}
