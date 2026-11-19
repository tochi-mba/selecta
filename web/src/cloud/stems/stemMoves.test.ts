import { describe, expect, it, vi } from 'vitest';
import type { FlagId } from '../../flags';

// cloud.browser_stems is registered by the integrator; until then this test registers it itself.
vi.mock('../../flags', async (original) => {
  const real = await original<typeof import('../../flags')>();
  return { ...real, REGISTRY: { ...real.REGISTRY, 'cloud.browser_stems': { area: 'cloud', label: 'Browser stems', about: '' } } };
});

const { browserMoveNames, browserMovesOffered, browserStemMovesAllowed, moveWords, stemMovesAutoMayPick, STEM_MOVE_WORDS } = await import('../browserMoves');

const all = () => true;
const without = (...off: string[]) => (id: FlagId) => !off.includes(id);
const PLAIN = ['auto', 'bass_swap_blend', 'filter_sweep', 'cut_on_one', 'echo_out', 'reverb_wash'];

describe('stem moves in the Move picker', () => {
  it('names the stem moves as local mode does', () => {
    expect(STEM_MOVE_WORDS.vocal_ride.label).toBe('Vocal ride');
    expect(STEM_MOVE_WORDS.stem_arrange.label).toBe('Strip and land');
    expect(STEM_MOVE_WORDS.stem_intertwine.label).toBe('Intertwined stems');
    expect(moveWords('vocal_ride')?.label).toBe('Vocal ride');
    expect(moveWords('filter_sweep')?.label).toBe('Filter sweep');
    expect(moveWords('nope')).toBeUndefined();
  });

  it('with stems off, lists exactly the plain moves (reflow)', () => {
    expect(browserMovesOffered(null, all).map((offer) => offer.move)).toEqual(PLAIN);
    expect(browserMovesOffered({ state: 'ready' }, without('cloud.browser_stems')).map((offer) => offer.move)).toEqual(PLAIN);
    expect(browserMovesOffered({ state: 'ready' }, without('stems')).map((offer) => offer.move)).toEqual(PLAIN);
    expect(Object.keys(browserMoveNames(all))).toEqual(PLAIN);
  });

  it('honours each stem move’s own flag', () => {
    expect(browserStemMovesAllowed(all)).toEqual(['vocal_ride', 'stem_arrange', 'stem_intertwine']);
    expect(browserStemMovesAllowed(without('move.strip_and_land'))).toEqual(['vocal_ride', 'stem_intertwine']);
    expect(browserStemMovesAllowed(without('move.vocal_ride', 'move.intertwined_stems'))).toEqual(['stem_arrange']);
  });

  it('lists stem moves disabled with the device’s reason when it can’t split', () => {
    const offered = browserMovesOffered({ state: 'unavailable', reason: 'it has no WebGPU' }, all);
    const stems = offered.filter((offer) => offer.disabledReason);
    expect(stems.map((offer) => offer.move)).toEqual(['vocal_ride', 'stem_arrange', 'stem_intertwine']);
    expect(stems[0].disabledReason).toBe('This device can’t split songs into stems: it has no WebGPU');
    expect(offered.filter((offer) => !offer.disabledReason).map((offer) => offer.move)).toEqual(PLAIN);
    expect(stemMovesAutoMayPick({ state: 'unavailable', reason: 'x' }, all)).toEqual([]);
  });

  it('marks stem moves as needing the download, and lets Auto pick them only when ready', () => {
    const offered = browserMovesOffered({ state: 'download_needed' }, all);
    expect(offered.filter((offer) => offer.needsDownload).map((offer) => offer.move)).toEqual(['vocal_ride', 'stem_arrange', 'stem_intertwine']);
    expect(stemMovesAutoMayPick({ state: 'download_needed' }, all)).toEqual([]);
    expect(stemMovesAutoMayPick({ state: 'ready' }, all)).toEqual(['vocal_ride', 'stem_arrange', 'stem_intertwine']);
    const ready = browserMovesOffered({ state: 'ready' }, all);
    expect(ready.every((offer) => !offer.disabledReason && !offer.needsDownload)).toBe(true);
    expect(ready).toHaveLength(PLAIN.length + 3);
  });
});
