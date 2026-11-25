/** A song's waveform for Listen's strip, drawn from the member's own file on this device
 * (ADR-0459 Tier 1: decode only, nothing measured). The same envelope the Python engine stores
 * (`analysis/features.py` waveform_peaks): RMS per bin, scaled so the loudest bin is 1. It is a
 * picture of loudness over time, never a claim about sections, beats or energy. */

export const WAVEFORM_BINS = 400;
/** Samples per channel read between two turns the page gets back, in peaksInSlices. A few
 * milliseconds of work on a slow laptop, so playback's own page work is never held up. */
export const SLICE_SAMPLES = 1 << 18;

export type PcmChannels = { numberOfChannels: number; length: number; getChannelData(channel: number): Float32Array };

function plan(audio: PcmChannels, bins: number) {
  const count = Math.max(1, Math.min(bins, audio.length));
  const step = Math.max(1, Math.floor(audio.length / count));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  return { count, step, channels };
}

function binRms(audio: PcmChannels, channels: Float32Array[], step: number, bin: number): number {
  const start = bin * step;
  const end = Math.min(audio.length, start + step);
  let sum = 0;
  for (const data of channels) {
    for (let i = start; i < end; i += 1) sum += data[i] * data[i];
  }
  return Math.sqrt(sum / Math.max(1, (end - start) * channels.length));
}

function scaled(rms: number[]): number[] {
  const loudest = Math.max(...rms) || 1;
  return rms.map((value) => Math.round((value / loudest) * 1000) / 1000);
}

export function peaksFrom(audio: PcmChannels, bins = WAVEFORM_BINS): number[] {
  const { count, step, channels } = plan(audio, bins);
  const rms: number[] = [];
  for (let bin = 0; bin < count; bin += 1) rms.push(binRms(audio, channels, step, bin));
  return scaled(rms);
}

/** The same peaks as peaksFrom, read a slice at a time with a turn for the page in between
 * (`rest`, media/breathe.ts). It rests before the first slice too, so whoever hands the audio over
 * (the engine, as it prepares a song to play) gets straight back to its own work. */
export async function peaksInSlices(audio: PcmChannels, rest: () => Promise<void>, bins = WAVEFORM_BINS, slice = SLICE_SAMPLES): Promise<number[]> {
  await rest();
  const { count, step, channels } = plan(audio, bins);
  const rms: number[] = [];
  let read = 0;
  for (let bin = 0; bin < count; bin += 1) {
    rms.push(binRms(audio, channels, step, bin));
    read += step;
    if (read >= slice && bin < count - 1) {
      read = 0;
      await rest();
    }
  }
  return scaled(rms);
}
