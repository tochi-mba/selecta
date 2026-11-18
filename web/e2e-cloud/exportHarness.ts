// Test-only browser entry for export-long-mix.cloud.ts (BF-0457-06). The spec bundles this file
// on the fly and injects it into a page, so the export runs in a real browser: real
// decodeAudioData, real OfflineAudioContext rendering in chunks, the real limiter, and the
// shipped WAV and FLAC encoders and checkers. Nothing here is mocked. The tracks are synthetic
// (generated tones and noise), so no owned or licensed audio is involved. It never ships: no
// app entry imports it.

import { exportFile, ExportFormat } from '../src/engine/export';
import { encodeFlac } from '../src/engine/flac';
import { validateFlac } from '../src/engine/flacDecode';
import { renderMix } from '../src/engine/render';
import { encodeWav } from '../src/engine/wav';

const RATE = 44100;

/** One synthetic song: a chord that changes per track, a kick-like pulse and a little noise. */
function synthTrack(seconds: number, index: number): Uint8Array {
  const frames = Math.round(seconds * RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const root = 110 * 2 ** (index / 4);
  let seed = 99 + index;
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / RATE;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const noise = (seed / 2147483648 - 0.5) * 0.02;
    const beat = t % 0.5;
    const kick = beat < 0.12 ? 0.5 * Math.exp(-beat * 30) * Math.sin(2 * Math.PI * 55 * beat) : 0;
    const chord = 0.15 * (Math.sin(2 * Math.PI * root * t) + Math.sin(2 * Math.PI * root * 1.25 * t) + Math.sin(2 * Math.PI * root * 1.5 * t));
    left[frame] = chord + kick + noise;
    right[frame] = 0.9 * chord + kick - noise;
  }
  const chunk = { numberOfChannels: 2, length: frames, sampleRate: RATE, getChannelData: (channel: number) => (channel === 0 ? left : right) };
  return encodeWav([chunk], 16).bytes;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) text += String.fromCharCode(...bytes.subarray(at, at + step));
  return btoa(text);
}

export type HarnessResult =
  | { ok: false; reason: string; detail: string }
  | {
      ok: true;
      format: ExportFormat;
      durationSeconds: number;
      sha256: string;
      mimeType: string;
      limiter: string;
      base64: string;
      elapsedMs: number;
      /** The longest gap between 50 ms heartbeats while exporting: how long the page froze. */
      longestStallMs: number;
      progress: number[];
    };

async function exportSynthetic(format: ExportFormat, trackSeconds: number[], cancelAfterMs?: number): Promise<HarnessResult> {
  const decoder = new OfflineAudioContext(2, 1, RATE);
  // Songs are synthesised before the clock starts: making test audio is harness work, not the
  // engine's, so it must not count against the engine's stall figure.
  const songs = trackSeconds.map((seconds, index) => synthTrack(seconds, index));
  const tracks = songs.map((bytes, index) => ({
    id: index,
    data: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }));
  const control = new AbortController();
  if (cancelAfterMs !== undefined) setTimeout(() => control.abort(), cancelAfterMs);
  let last = performance.now();
  let longestStallMs = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    longestStallMs = Math.max(longestStallMs, now - last);
    last = now;
  }, 50);
  const progress: number[] = [];
  const started = performance.now();
  let result: Awaited<ReturnType<typeof exportFile>>;
  try {
    result = await exportFile({
      tracks,
      decode: (bytes) => decoder.decodeAudioData(bytes),
      format,
      bits: 16,
      signal: control.signal,
      onProgress: (step) => progress.push(step.renderedSeconds),
    });
  } finally {
    // Stop the clock before the harness copies the file out (base64 is harness work too).
    clearInterval(beat);
    longestStallMs = Math.max(longestStallMs, performance.now() - last);
  }
  const elapsedMs = performance.now() - started;
  if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
  return {
    ok: true,
    format: result.file.format,
    durationSeconds: result.file.durationSeconds,
    sha256: result.file.sha256,
    mimeType: result.file.mimeType,
    limiter: result.file.limiter,
    base64: toBase64(result.file.bytes),
    elapsedMs,
    longestStallMs,
    progress,
  };
}

/** Time `work` with a 50 ms heartbeat: elapsed time and the longest stall it caused. */
async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number; longestStallMs: number }> {
  let last = performance.now();
  let longestStallMs = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    longestStallMs = Math.max(longestStallMs, now - last);
    last = now;
  }, 50);
  const started = performance.now();
  try {
    const value = await work();
    return { value, ms: performance.now() - started, longestStallMs: Math.max(longestStallMs, performance.now() - last) };
  } finally {
    clearInterval(beat);
  }
}

export type PhaseTimes = {
  render: { ms: number; longestStallMs: number };
  encode: { ms: number; longestStallMs: number };
  check: { ms: number; longestStallMs: number; ok: boolean };
};

/** The FLAC export one phase at a time, so a stall can be pinned on the step that causes it. */
async function flacPhases(trackSeconds: number[]): Promise<PhaseTimes> {
  const decoder = new OfflineAudioContext(2, 1, RATE);
  const songs = trackSeconds.map((seconds, index) => synthTrack(seconds, index));
  const tracks = songs.map((bytes, index) => ({
    id: index,
    data: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }));
  const render = await timed(() => renderMix({ tracks, decode: (bytes) => decoder.decodeAudioData(bytes) }));
  if (!render.value.ok) throw new Error(`render failed: ${render.value.detail}`);
  const rendered = render.value;
  const encode = await timed(() => encodeFlac(rendered.chunks, 16));
  const check = await timed(() => validateFlac(encode.value.bytes, { durationSeconds: rendered.durationSeconds, toleranceSeconds: 1 / RATE }));
  return {
    render: { ms: render.ms, longestStallMs: render.longestStallMs },
    encode: { ms: encode.ms, longestStallMs: encode.longestStallMs },
    check: { ms: check.ms, longestStallMs: check.longestStallMs, ok: check.value.ok },
  };
}

const scope = window as unknown as { selectaExportE2E: typeof exportSynthetic; selectaExportPhases: typeof flacPhases };
scope.selectaExportE2E = exportSynthetic;
scope.selectaExportPhases = flacPhases;
