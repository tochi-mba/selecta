import { describe, expect, it } from 'vitest';
import { fadeSchedule } from '../dsp/seams';
import { browserMoveNames, browserMovesAllowed } from './browserMoves';
import { playedByPair, playedWords } from './playedSeams';

describe('what a browser transition really played', () => {
  it('names the move, its length and why SelectaDJ picked it', () => {
    const words = playedWords({ implementation: 'x', kind: 'beatmatch', startSeconds: 1, windowSeconds: 8, events: [], style: 'bass_swap_blend', bars: 16, why: 'The tempos are 0.4 percent apart.' });
    expect(words).toEqual({ label: 'Blend, 16 bars', detail: 'The tempos are 0.4 percent apart.', fellBack: false });
  });

  it('says a fade is a fade, with the reason the move fell back', () => {
    const words = playedWords({ ...fadeSchedule(30, 0, 'x'), style: 'echo_out', degraded: [{ wanted: 'echo', instead: 'fade', reason: 'this device has no echo or reverb returns' }] });
    expect(words).toEqual({ label: 'Faded', detail: 'This device has no echo or reverb returns.', fellBack: true });
  });

  it('keys each record by its two songs, the latest one winning', () => {
    const schedule = { implementation: 'x', kind: 'beatmatch' as const, startSeconds: 1, windowSeconds: 0.02, events: [], style: 'echo_out' };
    const played = playedByPair([
      { fromIndex: 0, toIndex: 1, sources: { a: null, b: null }, schedule: { ...schedule, style: 'cut_on_one' }, pair: [7, 9] },
      { fromIndex: 0, toIndex: 1, sources: { a: null, b: null }, schedule, pair: [7, 9] },
      { fromIndex: 1, toIndex: 2, sources: { a: null, b: null }, schedule, pair: [9, null] },
    ]);
    expect(Object.keys(played)).toEqual(['7>9']);
    expect(played['7>9'].label).toBe('Echo out');
  });

  it('offers only the moves whose flags are on, SelectaDJ’s pick first', () => {
    expect(browserMovesAllowed(() => true)).toEqual(['auto', 'bass_swap_blend', 'filter_sweep', 'cut_on_one', 'echo_out', 'reverb_wash']);
    expect(Object.keys(browserMoveNames((id) => id !== 'move.echo_out'))).toEqual(['auto', 'bass_swap_blend', 'filter_sweep', 'cut_on_one', 'reverb_wash']);
  });
});
