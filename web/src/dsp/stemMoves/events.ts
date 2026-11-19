/** A stem plan flattened into timed events, in the SeamEvent vocabulary of seams.ts with the
 * stem each event drives ('mix' for a deck's full mix). */

import type { StemName, StemSeamPlan, StemSide } from './types';

export interface StemEvent {
  deck: StemSide;
  stem: StemName | 'mix';
  kind: 'start' | 'gain' | 'stop' | 'eq' | 'filter' | 'send';
  at: number;
  sourceAt?: number;
  value?: number;
  band?: 'low' | 'mid' | 'high';
  filter?: 'highpass' | 'lowpass';
  hz?: number;
  effect?: 'echo';
}

export function stemEvents(plan: StemSeamPlan): StemEvent[] {
  const events: StemEvent[] = [];
  for (const layer of plan.layers) {
    const { side: deck, stem } = layer;
    events.push({ deck, stem, kind: 'start', at: layer.from, sourceAt: layer.sourceFrom });
    for (const [at, value] of layer.gain) events.push({ deck, stem, kind: 'gain', at, value });
    for (const eq of layer.eq ?? []) for (const [at, value] of eq.points) events.push({ deck, stem, kind: 'eq', band: eq.band, at, value });
    for (const sweep of layer.filter ?? []) for (const [at, hz] of sweep.points) events.push({ deck, stem, kind: 'filter', filter: sweep.filter, at, hz });
    for (const send of layer.sends ?? []) for (const [at, value] of send.points) events.push({ deck, stem, kind: 'send', effect: send.effect, at, value });
    events.push({ deck, stem, kind: 'stop', at: layer.until });
  }
  for (const [at, value] of plan.native.a) events.push({ deck: 'a', stem: 'mix', kind: 'gain', at, value });
  events.push({ deck: 'a', stem: 'mix', kind: 'stop', at: plan.native.a[plan.native.a.length - 1][0] + 1e-6 });
  events.push({ deck: 'b', stem: 'mix', kind: 'start', at: plan.handoverToNative.startAt, sourceAt: plan.handoverToNative.bSourceAt });
  for (const [at, value] of plan.native.b) events.push({ deck: 'b', stem: 'mix', kind: 'gain', at, value });
  return events.sort((left, right) => left.at - right.at);
}
