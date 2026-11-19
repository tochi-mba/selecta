/** The echo and wash returns for scripted seams (ADR-0459 Tier 1): local mode's echo_out,
 * delay_throw and reverb_wash tails, built live in Web Audio.
 *
 * The reference engine (`src/selecta/render/dsp.py` echo_tail and reverb_tail) renders a tail
 * offline from a send of the outgoing song: repeats only for the echo, each a little darker,
 * through a highpassed return; a damped decaying room for the wash. A live graph cannot render
 * ahead, so this is a reduced implementation under its own id, never claimed to be the same:
 *  - echo: a DelayNode in a feedback loop through a lowpass (the darkening), its return
 *    highpassed and set to the wet level. Only the repeats come back, as in the reference;
 *  - wash: a ConvolverNode on a generated impulse, exponentially decaying noise whose top end
 *    falls away faster by `damping`, its return highpassed and set to the wet level.
 * The send is a gain the scripter moves with 'send' events; the return goes straight to the
 * deck's output, past the song's own fader, so the tail rings on after the fader closes, as in
 * the reference where the tail is added after the fader.
 * Whether this "sounds right" is the owner's listening pass, never this file's claim.
 */

import type { SeamEvent } from './seams';

export const SEAM_EFFECTS_IMPLEMENTATION = 'webaudio-seam-returns-v1';

/** `Echo` in src/selecta/render/script.py. */
export type EchoSpec = { delaySeconds: number; feedback: number; wet: number; returnHighpassHz: number; dampLowpassHz: number };
/** `Wash` in src/selecta/render/script.py. */
export type WashSpec = { wet: number; decaySeconds: number; damping: number; returnHighpassHz: number };
export type SeamEffects = { echo?: EchoSpec; wash?: WashSpec };

/** One built return: its send (the scripter moves its gain) and how long its tail can ring. */
export type EffectReturn = { effect: 'echo' | 'wash'; send: GainNode; tailSeconds: number; dispose(): void };

/** Whether this context can build the returns at all. */
export function canMakeEffects(context: BaseAudioContext): boolean {
  const parts = context as Partial<BaseAudioContext>;
  return typeof parts.createDelay === 'function' && typeof parts.createConvolver === 'function'
    && typeof parts.createBiquadFilter === 'function' && typeof parts.createBuffer === 'function';
}

/** How long an echo's repeats stay above -60 dB, bounded so a loop never rings for ever. */
export function echoTailSeconds(spec: EchoSpec): number {
  const feedback = Math.min(Math.max(spec.feedback, 0.01), 0.95);
  const repeats = Math.ceil(Math.log(0.001) / Math.log(feedback));
  return Math.min(12, spec.delaySeconds * Math.max(1, repeats));
}

/** A stereo impulse: decaying noise, the top end dying faster by `damping`. Deterministic, so
 * the same seam always gets the same room. */
export function washImpulse(context: BaseAudioContext, spec: WashSpec): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.round(rate * spec.decaySeconds));
  const impulse = context.createBuffer(2, length, rate);
  let seed = 0x2545f491;
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  // a one-pole lowpass whose coefficient closes over the tail: later reflections are darker
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i += 1) {
      const through = i / length;
      const envelope = Math.exp(-6.9 * through);
      const keep = 1 - Math.min(0.95, spec.damping * through);
      smooth = smooth + keep * (noise() - smooth);
      data[i] = smooth * envelope;
    }
  }
  return impulse;
}

/** Build the returns one deck's seam asks for, fed from `from` and returning to `to`. */
export function makeReturns(context: BaseAudioContext, from: AudioNode, to: AudioNode, effects: SeamEffects): EffectReturn[] {
  const made: EffectReturn[] = [];
  if (effects.echo) {
    const spec = effects.echo;
    const send = context.createGain();
    send.gain.value = 0;
    const delay = context.createDelay(Math.max(1, spec.delaySeconds + 0.1));
    delay.delayTime.value = spec.delaySeconds;
    const damp = context.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = spec.dampLowpassHz;
    const loop = context.createGain();
    loop.gain.value = Math.min(Math.max(spec.feedback, 0), 0.95);
    const back = context.createBiquadFilter();
    back.type = 'highpass';
    back.frequency.value = spec.returnHighpassHz;
    const wet = context.createGain();
    wet.gain.value = spec.wet;
    from.connect(send);
    send.connect(delay);
    delay.connect(damp);
    damp.connect(loop);
    loop.connect(delay);
    damp.connect(back);
    back.connect(wet);
    wet.connect(to);
    made.push({
      effect: 'echo',
      send,
      tailSeconds: echoTailSeconds(spec),
      dispose() { for (const node of [send, delay, damp, loop, back, wet]) node.disconnect(); },
    });
  }
  if (effects.wash) {
    const spec = effects.wash;
    const send = context.createGain();
    send.gain.value = 0;
    const room = context.createConvolver();
    room.normalize = true;
    room.buffer = washImpulse(context, spec);
    const back = context.createBiquadFilter();
    back.type = 'highpass';
    back.frequency.value = spec.returnHighpassHz;
    const wet = context.createGain();
    wet.gain.value = spec.wet;
    from.connect(send);
    send.connect(room);
    room.connect(back);
    back.connect(wet);
    wet.connect(to);
    made.push({
      effect: 'wash',
      send,
      tailSeconds: spec.decaySeconds,
      dispose() { for (const node of [send, room, back, wet]) node.disconnect(); },
    });
  }
  return made;
}

/** Write the 'send' events for one effect onto its send gain. `base` turns schedule times into
 * context time, as applyMoves does. */
export function applySends(made: EffectReturn, events: readonly SeamEvent[], base: number): void {
  const points = [...events].sort((left, right) => left.at - right.at);
  points.forEach((event, index) => {
    const time = Math.max(0, base + event.at);
    if (index === 0) made.send.gain.setValueAtTime(event.value ?? 0, time);
    else made.send.gain.linearRampToValueAtTime(event.value ?? 0, time);
  });
}
