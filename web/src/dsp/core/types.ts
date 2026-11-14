/** Device-local PCM only. Never serialize these objects into Cloud requests. */
export const DSP_VERSION = 'br64-03/1.0.0' as const;
export type PCM = { sampleRate: number; channels: Float32Array[]; originSeconds: number };
export type Quality = 'reference-candidate' | 'approximate' | 'unsupported_here';
export type DSPArtifact = {
  version: typeof DSP_VERSION;
  kind: 'analysis' | 'prepared-seam';
  source: 'local-pcm';
  quality: Quality;
  sampleRate: number;
  startSeconds: number;
  durationSeconds: number;
  channels: number;
  notes: string[];
};
export type PreparedAudio = DSPArtifact & { kind: 'prepared-seam'; pcm: PCM; peakDb: number; truePeakDb: number };
export type ProcessingBudget = { maxFrames: number; maxBytes: number; maxChannels: number; fftSize: number; hop: number };
export const MOBILE_BUDGET: ProcessingBudget = { maxFrames: 48_000 * 8, maxBytes: 32 * 1024 * 1024, maxChannels: 2, fftSize: 1024, hop: 256 };
export const DESKTOP_BUDGET: ProcessingBudget = { maxFrames: 48_000 * 24, maxBytes: 128 * 1024 * 1024, maxChannels: 2, fftSize: 2048, hop: 512 };

export class DSPUnsupported extends Error {
  readonly code = 'unsupported_here';
  constructor(message: string) { super(message); this.name = 'DSPUnsupported'; }
}
export class DSPCancelled extends Error {
  readonly code = 'cancelled';
  constructor() { super('DSP processing cancelled'); this.name = 'DSPCancelled'; }
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DSPCancelled();
}
export function assertPCM(pcm: PCM, budget?: ProcessingBudget): number {
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate < 8_000 || pcm.sampleRate > 192_000 ||
      !Number.isFinite(pcm.originSeconds) || pcm.originSeconds < 0 ||
      !Array.isArray(pcm.channels) || !pcm.channels.length || pcm.channels.length > 8)
    throw new DSPUnsupported('Malformed or unsupported local PCM format');
  const length = pcm.channels[0]?.length ?? 0;
  if (!length || !pcm.channels.every(c => c instanceof Float32Array && c.length === length))
    throw new DSPUnsupported('PCM channels must contain equal nonempty planar Float32Arrays');
  if (budget && (length > budget.maxFrames || pcm.channels.length > budget.maxChannels ||
      length * pcm.channels.length * Float32Array.BYTES_PER_ELEMENT > budget.maxBytes))
    throw new DSPUnsupported('PCM window exceeds this device processing budget');
  return length;
}
export function allocatePCM(sampleRate: number, channels: number, frames: number, originSeconds = 0, budget = DESKTOP_BUDGET): PCM {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > budget.maxFrames ||
      !Number.isSafeInteger(channels) || channels < 1 || channels > budget.maxChannels ||
      frames * channels * 4 > budget.maxBytes)
    throw new DSPUnsupported('Requested PCM allocation exceeds device budget');
  const pcm = { sampleRate, channels: Array.from({ length: channels }, () => new Float32Array(frames)), originSeconds };
  assertPCM(pcm, budget);
  return pcm;
}
export function mono(pcm: PCM): Float32Array {
  const n = assertPCM(pcm), out = new Float32Array(n);
  for (const channel of pcm.channels) for (let i = 0; i < n; i++) out[i] += channel[i] / pcm.channels.length;
  return out;
}
export function db(value: number): number { return 20 * Math.log10(Math.max(value, 1e-12)); }
export function clamp(v: number, a: number, b: number): number { return Math.min(b, Math.max(a, v)); }
export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b)=>a-b);
  const h = Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[h] : (sorted[h-1]+sorted[h])/2;
}
