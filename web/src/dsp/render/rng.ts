/** numpy's `default_rng(seed).standard_normal(n)`, bit for bit.
 *
 * The Desktop's reverb (`dsp.room_response`) is decaying noise from `default_rng(11)`, so the
 * browser makes the same noise: numpy's SeedSequence turns the seed into PCG64's 128-bit state
 * and increment, PCG64 (XSL-RR output) gives 64-bit words, and the 256-layer ziggurat turns them
 * into normals with numpy's own tables (rngTables.ts). Checked against numpy for two million
 * draws. Only whole seeds below 2^32 are taken, which is all the renderer uses.
 */

import { FI, KI, WI } from './rngTables';

const INIT_A = 0x43b0d7e5;
const MULT_A = 0x931e8875;
const INIT_B = 0x8b51f9dd;
const MULT_B = 0x58f38ded;
const MIX_MULT_L = 0xca01f9dd;
const MIX_MULT_R = 0x4973f715;
const POOL_SIZE = 4;

const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;
const PCG_MULTIPLIER = 0x2360ed051fc65da44385df649fccf645n;

const ZIGGURAT_R = 3.6541528853610087963519472518;
const ZIGGURAT_INV_R = 0.27366123732975827203338247596;

/** SeedSequence(seed).generate_state(4, uint64), as four 64-bit words. */
export function seedState(seed: number): bigint[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('the generator takes a whole seed below 2^32');
  let hashConst = INIT_A;
  const hashmix = (value: number): number => {
    let out = (value ^ hashConst) >>> 0;
    hashConst = Math.imul(hashConst, MULT_A) >>> 0;
    out = Math.imul(out, hashConst) >>> 0;
    return (out ^ (out >>> 16)) >>> 0;
  };
  const mix = (x: number, y: number): number => {
    const out = (Math.imul(MIX_MULT_L, x) - Math.imul(MIX_MULT_R, y)) >>> 0;
    return (out ^ (out >>> 16)) >>> 0;
  };
  const entropy = [seed];
  const pool: number[] = [];
  for (let index = 0; index < POOL_SIZE; index += 1) pool.push(hashmix(index < entropy.length ? entropy[index] : 0));
  for (let source = 0; source < POOL_SIZE; source += 1) {
    for (let target = 0; target < POOL_SIZE; target += 1) {
      if (source !== target) pool[target] = mix(pool[target], hashmix(pool[source]));
    }
  }
  const words: number[] = [];
  let hash = INIT_B;
  for (let index = 0; index < 8; index += 1) {
    let value = (pool[index % POOL_SIZE] ^ hash) >>> 0;
    hash = Math.imul(hash, MULT_B) >>> 0;
    value = Math.imul(value, hash) >>> 0;
    words.push((value ^ (value >>> 16)) >>> 0);
  }
  const out: bigint[] = [];
  for (let index = 0; index < 4; index += 1) out.push(BigInt(words[2 * index]) | (BigInt(words[2 * index + 1]) << 32n));
  return out;
}

/** numpy's PCG64 bit generator (`pcg64_set_seed`, then XSL-RR on each step). */
export class Pcg64 {
  private state = 0n;
  private readonly increment: bigint;

  constructor(seed: number) {
    const [s0, s1, i0, i1] = seedState(seed);
    const initial = (s0 << 64n) | s1;
    const sequence = (i0 << 64n) | i1;
    this.increment = ((sequence << 1n) | 1n) & MASK128;
    this.step();
    this.state = (this.state + initial) & MASK128;
    this.step();
  }

  private step(): void {
    this.state = (this.state * PCG_MULTIPLIER + this.increment) & MASK128;
  }

  nextUint64(): bigint {
    this.step();
    const state = this.state;
    const folded = ((state >> 64n) ^ state) & MASK64;
    const rotation = state >> 122n;
    return ((folded >> rotation) | (folded << ((64n - rotation) & 63n))) & MASK64;
  }

  /** A double in [0, 1): the top 53 bits. */
  nextDouble(): number {
    return Number(this.nextUint64() >> 11n) * (1.0 / 9007199254740992.0);
  }

  /** `random_standard_normal`: numpy's ziggurat. */
  standardNormal(): number {
    for (;;) {
      const word = this.nextUint64();
      const layer = Number(word & 0xffn);
      const rest = word >> 8n;
      const negative = (rest & 1n) === 1n;
      const magnitude = Number((rest >> 1n) & 0x000fffffffffffffn);
      let x = magnitude * WI[layer];
      if (negative) x = -x;
      if (magnitude < KI[layer]) return x;
      if (layer === 0) {
        for (;;) {
          const xx = -ZIGGURAT_INV_R * Math.log1p(-this.nextDouble());
          const yy = -Math.log1p(-this.nextDouble());
          if (yy + yy > xx * xx) return Number((BigInt(magnitude) >> 8n) & 1n) ? -(ZIGGURAT_R + xx) : ZIGGURAT_R + xx;
        }
      }
      if ((FI[layer - 1] - FI[layer]) * this.nextDouble() + FI[layer] < Math.exp(-0.5 * x * x)) return x;
    }
  }
}

/** `default_rng(seed).standard_normal(count)`, rounded to float32 as `astype(np.float32)`. */
export function standardNormalsF32(seed: number, count: number): Float32Array {
  const generator = new Pcg64(seed);
  const out = new Float32Array(count);
  for (let index = 0; index < count; index += 1) out[index] = generator.standardNormal();
  return out;
}
