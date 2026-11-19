// The output level meter (ADR-0445 health): RMS of what SelectaDJ itself sends out, read from an
// AnalyserNode after the gain, in dBFS. Below -60 dBFS while playing is digital silence, which
// the server turns into a silent-zone alert. It cannot hear the room: an amplifier that is off
// is invisible here, and the copy never claims otherwise.

export const SILENT_DBFS = -60;
export const FLOOR_DBFS = -120;

/** Root-mean-square level of the samples in dBFS (full scale = 0), floored at -120. */
export function rmsDbfs(samples: ArrayLike<number>): number {
  if (!samples.length) return FLOOR_DBFS;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return FLOOR_DBFS;
  return Math.max(FLOOR_DBFS, Math.round(20 * Math.log10(rms) * 10) / 10);
}

export const isDigitalSilence = (dbfs: number | null) => dbfs !== null && dbfs < SILENT_DBFS;

type AnalyserLike = { fftSize: number; getFloatTimeDomainData(target: Float32Array): void };

/** Reads the analyser on demand; null when there is no analyser (no Web Audio). */
export function outputMeter(analyser: AnalyserLike | null) {
  const buffer = analyser ? new Float32Array(analyser.fftSize) : null;
  return {
    level(): number | null {
      if (!analyser || !buffer) return null;
      analyser.getFloatTimeDomainData(buffer);
      return rmsDbfs(buffer);
    },
  };
}
