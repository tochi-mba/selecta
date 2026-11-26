/** The onset envelope the beat grid is refined against: `analysis/beats.py::onset_envelope`,
 * which is librosa.onset.onset_strength(y, sr=22050, hop_length=128, n_fft=1024,
 * aggregate=np.median) in librosa 1.0.
 *
 * A 128-band mel power spectrogram (centred 1024-sample frames every 128 samples), in decibels
 * with an 80 dB floor below the loudest cell, its positive rise from each frame to the next, the
 * median rise across the bands, and five frames of zeros in front (one for the lag, four for the
 * centred frames), cut to the spectrogram's length. Float32 where librosa is float32.
 *
 * Work: one 1024-point real FFT per 128 samples (about 172 a second of audio) and a sparse mel
 * pass; memory: the 128-band spectrogram, half a kilobyte per frame.
 */

import { PowerFrames, stftFrameCount } from './fftPlan';
import { applyFilterbank, melFilterbank, powerToDbInPlace, type SparseFilterbank } from './mel';
import { medianInPlaceF32 } from './numeric';

export const ONSET_SR = 22050;
export const ONSET_HOP = 128;
export const ONSET_N_FFT = 1024;
export const ONSET_MELS = 128;
export const ONSET_HOP_TIME = ONSET_HOP / ONSET_SR;

let bank: SparseFilterbank | null = null;

/** The onset envelope of a 22,050 Hz mono signal, one value per 128-sample frame. */
export function onsetEnvelope(mono22k: Float32Array): Float32Array {
  bank ??= melFilterbank(ONSET_SR, ONSET_N_FFT, ONSET_MELS);
  const frames = stftFrameCount(mono22k.length, ONSET_HOP);
  const stft = new PowerFrames(ONSET_N_FFT, ONSET_HOP);
  const power = new Float32Array(stft.fft.bins);
  const mel = new Float32Array(frames * ONSET_MELS);
  for (let frame = 0; frame < frames; frame += 1) {
    stft.power(mono22k, frame, power);
    applyFilterbank(bank, power, mel, frame * ONSET_MELS);
  }
  powerToDbInPlace(mel, 80);
  const lag = 1;
  const pad = lag + Math.floor(ONSET_N_FFT / (2 * ONSET_HOP));
  const envelope = new Float32Array(frames);
  const rises = new Float64Array(ONSET_MELS);
  for (let frame = lag; frame < frames; frame += 1) {
    const at = frame - lag + pad;
    if (at >= frames) break;
    const now = frame * ONSET_MELS;
    const before = (frame - lag) * ONSET_MELS;
    for (let band = 0; band < ONSET_MELS; band += 1) {
      const rise = Math.fround(mel[now + band] - mel[before + band]);
      rises[band] = rise > 0 ? rise : 0;
    }
    envelope[at] = medianInPlaceF32(rises, ONSET_MELS);
  }
  return envelope;
}
