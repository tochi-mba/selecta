import { afterEach, describe, expect, it } from 'vitest';
import { setFlags } from '../flags';
import { delayFrom, MAX_OUTPUT_DELAY_MS, outputDelayMs, readOutputDelay, resetOutputDelay } from './outputDelay';
import { resetFeel } from './root';

/** T-20261125-6dc8: the speakers' reported lag, read from the context the player's analyser taps
 * belong to, clamped, and nothing at all where the browser reports nothing. */

const tapped = (context: unknown) => ({ getVisualTaps: () => ({ left: { context } }) });

afterEach(() => {
  resetOutputDelay();
  resetFeel();
});

describe('the output delay', () => {
  it('prefers outputLatency, falls back to baseLatency, and is 0 when unreported', () => {
    expect(delayFrom({ outputLatency: 0.18, baseLatency: 0.01 })).toBe(180);
    expect(delayFrom({ outputLatency: 0, baseLatency: 0.012 })).toBe(12);
    expect(delayFrom({ baseLatency: 0.005 })).toBe(5);
    expect(delayFrom({})).toBe(0);
    expect(delayFrom({ outputLatency: Number.NaN })).toBe(0);
    expect(delayFrom(null)).toBe(0);
  });

  it('is clamped, so a wrong number never makes the chrome trail by more than half a second', () => {
    expect(delayFrom({ outputLatency: 3 })).toBe(MAX_OUTPUT_DELAY_MS);
    expect(delayFrom({ outputLatency: -1 })).toBe(0);
  });

  it('reads from the player’s own taps, and 0 for music with none here', () => {
    expect(readOutputDelay(tapped({ outputLatency: 0.25 }))).toBe(250);
    expect(outputDelayMs()).toBe(250);
    expect(readOutputDelay({ getVisualTaps: () => null })).toBe(0);
    expect(readOutputDelay({})).toBe(0);
  });

  it('is 0 with the music feel off, so nothing outside it moves', () => {
    readOutputDelay(tapped({ outputLatency: 0.25 }));
    setFlags({ 'app.feel_music': false, 'app.feel_ambient': false });
    expect(outputDelayMs()).toBe(0);
    setFlags({ 'app.feel_music': true, 'app.feel_ambient': true });
  });
});
