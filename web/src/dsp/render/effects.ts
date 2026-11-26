/** The send effects of src/selecta/render/dsp.py: the darkening echo and the noise-hall wash. */

import { convolveStereo } from './convolve';
import { type Channels, zeroPhaseHighpass, zeroPhaseLowpass } from './filters';
import { f32, roundHalfEven } from './npy';
import { standardNormalsF32 } from './rng';
import { SAMPLE_RATE } from './script';

/** `echo_tail`: repeats only, each one through the damping lowpass again, the sum high-passed. */
export function echoTail(
  send: Channels,
  delaySeconds: number,
  feedback: number,
  wet: number,
  returnHighpassHz: number,
  dampLowpassHz: number,
  total: number,
): Channels {
  const spacing = roundHalfEven(delaySeconds * SAMPLE_RATE);
  let delay = spacing;
  const tail = send.map(() => new Float32Array(total));
  let voice = send;
  let gain = wet;
  while (gain > 0.01) {
    const tailEnd = Math.min(total, send[0].length + delay);
    const length = tailEnd - delay;
    if (length <= 0) break;
    voice = zeroPhaseLowpass(voice, dampLowpassHz);
    const scale = f32(gain);
    tail.forEach((channel, c) => {
      const source = voice[c];
      for (let index = 0; index < length; index += 1) channel[delay + index] = f32(channel[delay + index] + f32(source[index] * scale));
    });
    gain *= feedback;
    delay += spacing;
  }
  return zeroPhaseHighpass(tail, returnHighpassHz);
}

const NOISE_SEED = 11;
let noise: Float32Array = new Float32Array(0);

/** The first `count` values of `default_rng(11).standard_normal`, kept and extended as needed:
 * numpy fills a (samples, 2) array row by row, so a shorter room is a prefix of a longer one. */
function roomNoise(count: number): Float32Array {
  if (noise.length < count) noise = standardNormalsF32(NOISE_SEED, count);
  return noise;
}

/** `room_response(decay_seconds, damping, seed=11)`: decaying noise, highs dying first, each
 * channel at unit energy, with 15 ms of silence in front. */
export function roomResponse(decaySeconds = 2.2, damping = 0.45): Channels {
  const length = Math.trunc(decaySeconds * 1.5 * SAMPLE_RATE);
  const values = roomNoise(2 * length);
  const raw = [new Float32Array(length), new Float32Array(length)];
  for (let index = 0; index < length; index += 1) {
    raw[0][index] = values[2 * index];
    raw[1][index] = values[2 * index + 1];
  }
  const low = zeroPhaseLowpass(raw, 700);
  const lowScale = f32(-6.91);
  const lowDivisor = f32(decaySeconds);
  const highDivisor = f32(decaySeconds * Math.max(1 - damping, 0.1));
  const onset = Math.trunc(0.012 * SAMPLE_RATE);
  const ramp = new Float32Array(onset);
  for (let index = 0; index < onset; index += 1) ramp[index] = index === onset - 1 ? 1 : index * (1 / (onset - 1));
  const response = [new Float32Array(length), new Float32Array(length)];
  for (let index = 0; index < length; index += 1) {
    const time = f32(index / SAMPLE_RATE);
    const scaled = f32(lowScale * time);
    const lowDecay = f32(Math.exp(f32(scaled / lowDivisor)));
    const highDecay = f32(Math.exp(f32(scaled / highDivisor)));
    for (let c = 0; c < 2; c += 1) {
      const high = f32(raw[c][index] - low[c][index]);
      let value = f32(f32(low[c][index] * lowDecay) + f32(high * highDecay));
      if (index < onset) value = f32(value * ramp[index]);
      response[c][index] = value;
    }
  }
  // np.sum over axis 0 of a (samples, 2) array adds row after row, in float32
  for (let c = 0; c < 2; c += 1) {
    let energy = 0;
    for (const value of response[c]) energy = f32(energy + f32(value * value));
    const norm = f32(f32(Math.sqrt(energy)) + f32(1e-9));
    for (let index = 0; index < length; index += 1) response[c][index] = f32(response[c][index] / norm);
  }
  const predelay = Math.trunc(0.015 * SAMPLE_RATE);
  return response.map((channel) => {
    const out = new Float32Array(predelay + length);
    out.set(channel, predelay);
    return out;
  });
}

/** `reverb_tail`: the send through the room, cut to the send's length, times `wet`, high-passed. */
export function reverbTail(send: Channels, decaySeconds: number, damping: number, wet: number, returnHighpassHz: number): Channels {
  const response = roomResponse(decaySeconds, damping);
  const tail = convolveStereo(send, response, send[0].length);
  const scale = f32(wet);
  for (const channel of tail) for (let index = 0; index < channel.length; index += 1) channel[index] = f32(channel[index] * scale);
  return zeroPhaseHighpass(tail, returnHighpassHz);
}
