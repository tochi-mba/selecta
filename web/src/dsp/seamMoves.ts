/** The browser's EQ and filter moves for scripted seams (ADR-0459 Tier 1, BF-0459-04).
 *
 * The reference engine (`src/selecta/render/dsp.py`) splits a song into three zero-phase bands
 * that sum back to the input exactly, and builds a moving filter from a bank of fixed zero-phase
 * filters. A live browser graph cannot run zero-phase filters, so this is a reduced
 * implementation under its own id, never claimed to be the same thing:
 *  - the three bands are a low shelf at 200 Hz, a peaking band and a high shelf at 2500 Hz
 *    (the reference split points), each a minimum-phase biquad. At 0 dB a shelf or peaking
 *    biquad is exactly unity, so an untouched chain changes nothing;
 *  - a band's linear gain (1 untouched, 0 removed) maps to decibels with a -40 dB floor, so a
 *    "removed" band is a deep cut rather than the reference's exact zero;
 *  - the highpass and lowpass sweep exponentially in frequency and linearly in time, as the
 *    reference `sweep` curve does. Outside a sweep the highpass rests at 0 Hz and the lowpass at
 *    Nyquist, where the Web Audio biquads are defined to pass everything.
 * Whether any of this "sounds right" is the owner's listening pass, never this file's claim.
 */

import type { SeamEvent } from './seams';

export const SEAM_MOVES_IMPLEMENTATION = 'biquad-seam-moves-v1';
export const LOW_SPLIT_HZ = 200;
export const HIGH_SPLIT_HZ = 2500;
/** The geometric middle of the two split points, for the peaking mid band. */
export const MID_CENTRE_HZ = Math.sqrt(LOW_SPLIT_HZ * HIGH_SPLIT_HZ);
/** The deepest cut a band gain of 0 becomes. */
export const BAND_FLOOR_DB = -40;
const MIN_SWEEP_HZ = 10;

/** One layer's move chain: source -> low -> mid -> high -> highpass -> lowpass -> out. */
export type MovesChain = {
  input: AudioNode;
  output: AudioNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  dispose(): void;
};

/** Whether this context can build the move chain at all. */
export function canMakeMoves(context: BaseAudioContext): boolean {
  return typeof (context as Partial<BaseAudioContext>).createBiquadFilter === 'function';
}

/** A band's linear gain as the decibels its shelf is set to. */
export function bandDb(value: number): number {
  if (!(value > 0)) return BAND_FLOOR_DB;
  return Math.max(BAND_FLOOR_DB, Math.min(0, 20 * Math.log10(Math.min(value, 1))));
}

/** A neutral chain: every node passes the signal unchanged until a move is scheduled. */
export function makeMovesChain(context: BaseAudioContext): MovesChain {
  const nyquist = context.sampleRate / 2;
  const make = (type: BiquadFilterType, frequency: number) => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.gain.value = 0;
    return node;
  };
  const low = make('lowshelf', LOW_SPLIT_HZ);
  const mid = make('peaking', MID_CENTRE_HZ);
  mid.Q.value = 0.5;
  const high = make('highshelf', HIGH_SPLIT_HZ);
  const highpass = make('highpass', 0);
  const lowpass = make('lowpass', nyquist);
  low.connect(mid);
  mid.connect(high);
  high.connect(highpass);
  highpass.connect(lowpass);
  return {
    input: low,
    output: lowpass,
    low, mid, high, highpass, lowpass,
    dispose() {
      for (const node of [low, mid, high, highpass, lowpass]) node.disconnect();
    },
  };
}

/** Write one deck's 'eq' and 'filter' events onto its chain. `base` turns schedule times
 * (the outgoing song's own timeline) into context time. */
export function applyMoves(chain: MovesChain, events: readonly SeamEvent[], base: number, nyquist: number): void {
  const at = (time: number) => Math.max(0, base + time);
  const bands = { low: chain.low, mid: chain.mid, high: chain.high } as const;
  for (const band of ['low', 'mid', 'high'] as const) {
    const points = events
      .filter((event) => event.kind === 'eq' && event.band === band && event.value !== undefined)
      .sort((left, right) => left.at - right.at);
    points.forEach((event, index) => {
      const param = bands[band].gain;
      const db = bandDb(event.value as number);
      if (index === 0) param.setValueAtTime(db, at(event.at));
      else param.linearRampToValueAtTime(db, at(event.at));
    });
  }
  for (const filter of ['highpass', 'lowpass'] as const) {
    const points = events
      .filter((event) => event.kind === 'filter' && event.filter === filter && event.hz !== undefined)
      .sort((left, right) => left.at - right.at);
    if (!points.length) continue;
    const param = chain[filter].frequency;
    points.forEach((event, index) => {
      const hz = Math.min(Math.max(event.hz as number, MIN_SWEEP_HZ), nyquist);
      if (index === 0) param.setValueAtTime(hz, at(event.at));
      else param.exponentialRampToValueAtTime(hz, at(event.at));
    });
    // after the sweep the filter rests where it passes everything again
    const last = points[points.length - 1].at;
    param.setValueAtTime(filter === 'highpass' ? 0 : nyquist, at(last) + 0.05);
  }
}
