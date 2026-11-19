/** A song's waveform for Listen's strip, drawn from the member's own file on this device
 * (ADR-0459 Tier 1: decode only, nothing measured). The same envelope the Python engine stores
 * (`analysis/features.py` waveform_peaks): RMS per bin, scaled so the loudest bin is 1. It is a
 * picture of loudness over time, never a claim about sections, beats or energy. */

export const WAVEFORM_BINS = 400;

export type PcmChannels = { numberOfChannels: number; length: number; getChannelData(channel: number): Float32Array };

export function peaksFrom(audio: PcmChannels, bins = WAVEFORM_BINS): number[] {
  const count = Math.max(1, Math.min(bins, audio.length));
  const step = Math.max(1, Math.floor(audio.length / count));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  const rms: number[] = [];
  for (let bin = 0; bin < count; bin += 1) {
    const start = bin * step;
    const end = Math.min(audio.length, start + step);
    let sum = 0;
    for (const data of channels) {
      for (let i = start; i < end; i += 1) sum += data[i] * data[i];
    }
    rms.push(Math.sqrt(sum / Math.max(1, (end - start) * channels.length)));
  }
  const loudest = Math.max(...rms) || 1;
  return rms.map((value) => Math.round((value / loudest) * 1000) / 1000);
}
