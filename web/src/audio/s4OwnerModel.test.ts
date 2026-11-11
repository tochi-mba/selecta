import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioOwner, connectMainPlayer, mainPlayerTouched, releaseAudio, stopPreviewsOnly, takeAudio } from './focus';

/*
 * S4-0095-10: a model-based check of the single audio owner. Seeded random sequences of previews
 * starting and ending, previews stopped on the way elsewhere, and the listener pressing play or pause
 * on the mix themselves are run against the real audio focus, with the mix's pause taking a random
 * while to finish. After every step (and once everything has settled) the invariants must hold:
 * there is never more than one owner, an owner that is replaced is stopped exactly once and one
 * that ends by itself is never stopped, the mix is never playing under a preview, and once the
 * listener has pressed play or pause, no late resume undoes what they chose.
 * The scoped-writes and atomic-swap half of this suite is tests/test_s4_scope_model.py.
 */

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const settle = async () => {
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
};

afterEach(() => {
  stopPreviewsOnly();
  connectMainPlayer(null);
});

describe('S4-0095-10 one sound at a time, under random sequences', () => {
  it('holds every audio-owner invariant across 120 seeded runs', async () => {
    for (let run = 1; run <= 120; run += 1) {
      const random = seeded(run);
      const mix = { playing: random() < 0.7 };
      const slowPauses: (() => void)[] = [];
      connectMainPlayer({
        isPlaying: () => mix.playing,
        pause: () => (random() < 0.5
          ? new Promise<void>((done) => slowPauses.push(() => { mix.playing = false; done(); }))
          : void (mix.playing = false)),
        resume: () => { mix.playing = true; },
      });
      const stops = new Map<string, number>();
      const expected = new Map<string, number>();
      let current: string | null = null; // the model's owner
      let chose: boolean | null = null; // what the listener last chose for the mix, if anything
      let made = 0;
      const where = (step: number, action: string) => `seed ${run}, step ${step}: ${action}`;

      for (let step = 0; step < 30; step += 1) {
        const roll = random();
        let action: string;
        if (roll < 0.35) {
          made += 1;
          const id = `p${made}`;
          action = `start ${id}`;
          if (current) expected.set(current, 1);
          stops.set(id, 0);
          expected.set(id, 0);
          takeAudio({ id, label: id, stop: () => stops.set(id, (stops.get(id) ?? 0) + 1) });
          current = id;
          chose = null;
        } else if (roll < 0.6) {
          const id = current ?? `p${made}`;
          action = `${id} ends by itself`;
          releaseAudio(id);
          current = null;
        } else if (roll < 0.7) {
          action = 'stop previews only';
          if (current) expected.set(current, 1);
          stopPreviewsOnly();
          current = null;
        } else if (roll < 0.85) {
          // the player's own play or pause waits for a suspension already under way
          while (slowPauses.length) slowPauses.shift()?.();
          await settle();
          chose = random() < 0.5;
          action = `listener ${chose ? 'plays' : 'pauses'} the mix`;
          mainPlayerTouched();
          mix.playing = chose;
        } else {
          action = 'a slow pause finishes';
          slowPauses.shift()?.();
        }
        await settle();

        const owner = audioOwner();
        // never more than one owner, and only ever the newest preview still sounding
        expect(owner?.id ?? null, where(step, action)).toBe(current);
        // a replaced or stopped preview was stopped exactly once; one that ended by itself never was
        for (const [id, times] of expected) expect(stops.get(id), where(step, `${action} (${id})`)).toBe(times);
        // a preview that is sounding has the mix quiet, once its pause has finished
        if (owner && chose === null && slowPauses.length === 0) expect(mix.playing, where(step, action)).toBe(false);
        // what the listener chose stands, whatever late resume was queued, until the next preview
        if (chose !== null) expect(mix.playing, where(step, action)).toBe(chose);
      }
      while (slowPauses.length) slowPauses.shift()?.();
      await settle();
      if (chose !== null) expect(mix.playing, `seed ${run}: after settling`).toBe(chose);
      stopPreviewsOnly();
      connectMainPlayer(null);
      vi.clearAllMocks();
    }
  });
});
