import { describe, expect, it } from 'vitest';
import { FALLBACK_FADE_SECONDS } from '../dsp/crossfade';
import type { SeamRecord } from '../dsp/seamProvider';
import type { SchedulerClock } from '../engine/scheduler';
import { handoverWindow, seamShown } from './blendState';

// T-20261125-5baf and T-20261125-37fe: Listen in Cloud follows the hand-over the engine really
// scheduled, and keeps the outgoing song only while that hand-over lasts.

const record = (fromIndex: number, startSeconds: number, windowSeconds: number): SeamRecord => ({
  fromIndex, toIndex: fromIndex + 1, sources: { a: 'device', b: 'device' },
  schedule: { implementation: 'test', kind: 'beatmatch', startSeconds, windowSeconds, events: [] },
});
const clock = (over: Partial<SchedulerClock> = {}): SchedulerClock => ({ length: 200, next: null, entered: null, ...over });
const unknown = () => 0;

describe('the hand-over Listen shows in Cloud', () => {
  it('counts down to the planned seam when the engine scheduled it as planned', () => {
    const shown = seamShown({ position: 0, songTime: 150 }, unknown, [record(0, 170, 16)], clock({ next: { index: 1, at: 170, length: 240 } }));
    expect(shown).toMatchObject({ position: 0, seamAt: 170, inSeam: false, nextReady: true, blend: { window: 16, nextLength: 240 } });
  });

  it('counts down to the fallback fade, not the plan, when the engine could not use the plan', () => {
    // planned for 170 s, but the engine fades in at the song's end instead (fadeInto)
    const shown = seamShown({ position: 0, songTime: 180 }, unknown, [record(0, 170, 16)], clock({ next: { index: 1, at: 197, length: 240 } }));
    expect(shown.inSeam).toBe(false);
    expect(shown.seamAt).toBe(197);
    expect(shown.blend?.window).toBe(FALLBACK_FADE_SECONDS);
  });

  it('keeps the outgoing song, at its real time, while the hand-over plays, then moves on at once', () => {
    const seams = [record(0, 170, 16)];
    const during = seamShown({ position: 1, songTime: 12 }, unknown, seams, clock({ length: 240, entered: { fromIndex: 0, fromAt: 170, fromLength: 200, heard: 8 } }));
    expect(during).toMatchObject({ position: 0, songTime: 178, inSeam: true, seamAt: 170, duration: 200, blend: { window: 16, nextLength: 240, nextFrom: 4 } });
    const after = seamShown({ position: 1, songTime: 20.5 }, unknown, seams, clock({ length: 240, entered: { fromIndex: 0, fromAt: 170, fromLength: 200, heard: 16.5 } }));
    expect(after).toMatchObject({ position: 1, songTime: 20.5, inSeam: false, duration: 240 });
  });

  it('takes the decoded length where the stored one is missing, and the stored one where it is known', () => {
    expect(seamShown({ position: 2, songTime: 3 }, unknown, [], clock({ length: 187.4 })).duration).toBe(187.4);
    expect(seamShown({ position: 2, songTime: 3 }, () => 186, [], clock({ length: 187.4 })).duration).toBe(186);
  });

  it('claims no hand-over before the engine has scheduled one', () => {
    const shown = seamShown({ position: 0, songTime: 30 }, unknown, [record(0, 170, 16)], clock());
    expect(shown).toMatchObject({ seamAt: null, nextReady: false, inSeam: false, blend: null });
  });

  it('a fallback fade lasts no longer than half a short incoming song', () => {
    expect(handoverWindow([], 0, 1, 50, 4)).toBe(2);
    expect(handoverWindow([], 0, 1, 50, 0)).toBe(FALLBACK_FADE_SECONDS);
  });
});
