/** The synthetic songs of the device-analysis golden fixtures, rendered from their event lists.
 *
 * The shared contract with `render` in tools/device_analysis_golden.py: the same formulas in the
 * same order, summed in float64 and rounded to float32 once, so both languages measure the same
 * audio without committing any. Noise comes from a 32-bit hash of the sample index (lowbias32),
 * so it is the same in both. Used by tests; nothing here reads or makes real music.
 */

export interface SynthEvent {
  kind: 'kick' | 'hat' | 'snare' | 'tone';
  at: number;
  dur: number;
  amp: number;
  left: number;
  right: number;
  seed?: number;
  freqs?: number[];
  harmonics?: number[];
  attack?: number;
}

export interface SynthSong {
  name: string;
  sampleRate: number;
  durationS: number;
  events: SynthEvent[];
}

/** White noise in [-1, 1) for one sample index. */
export function hashNoise(index: number, seed: number): number {
  const offset = (seed * 0x9e3779b9) % 4294967296;
  let x = (index + offset) % 4294967296 >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 4294967296.0) * 2.0 - 1.0;
}

/** Left and right channels, float32. */
export function renderSong(song: SynthSong): [Float32Array, Float32Array] {
  const rate = song.sampleRate;
  const length = Math.floor(song.durationS * rate + 0.5);
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  const twoPi = 2.0 * Math.PI;
  for (const event of song.events) {
    const first = Math.floor(event.at * rate + 0.5);
    const count = Math.floor(event.dur * rate + 0.5);
    const stop = Math.min(first + count, length);
    for (let index = first; index < stop; index += 1) {
      const tau = index / rate - event.at;
      let voice: number;
      if (event.kind === 'kick') {
        const sweep = 45.0 * tau + 4.4 * (1.0 - Math.exp(-tau / 0.04));
        voice = event.amp * Math.sin(twoPi * sweep) * Math.exp(-tau / 0.12);
      } else if (event.kind === 'hat') {
        voice = event.amp * hashNoise(index, event.seed ?? 0) * Math.exp(-tau / 0.012);
      } else if (event.kind === 'snare') {
        const body = 0.6 * hashNoise(index, event.seed ?? 0) + 0.4 * Math.sin(twoPi * 190.0 * tau);
        voice = event.amp * body * Math.exp(-tau / 0.07);
      } else {
        const attack = event.attack ?? 0.01;
        const shape = Math.max(Math.min(Math.min(tau / attack, 1.0), (event.dur - tau) / 0.02), 0.0);
        let wave = 0;
        for (const freq of event.freqs ?? []) {
          (event.harmonics ?? []).forEach((weight, slot) => {
            wave += weight * Math.sin(twoPi * freq * (slot + 1) * tau);
          });
        }
        voice = event.amp * shape * wave;
      }
      left[index] += voice * event.left;
      right[index] += voice * event.right;
    }
  }
  return [Float32Array.from(left), Float32Array.from(right)];
}
