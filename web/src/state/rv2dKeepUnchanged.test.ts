import { describe, expect, it } from 'vitest';
import type { DraftList, MixData } from '../api';
import type { NowState } from '../player';
import { seam, songs } from '../test/backend';
import { sameApartFromClock } from '../views/clockMemo';
import { keepIfSame, keepUnchangedDrafts, keepUnchangedItems, keepUnchangedMix } from './keepUnchanged';

// rv2-d review: a changed nested field must never be kept stale, and an equal answer must be kept.

const data = (): MixData => ({ mix: songs(seam('ready', 'a'), seam('none', 'b')), name: 'Mix', can_undo: false });

const drafts = (ready = 1): DraftList => ({
  drafts: [
    { id: 1, name: 'One', songs: 2, seconds: 300, seams: 1, ready, waiting: 0, missing: 0, place: null, to_render: 0 } as unknown as DraftList['drafts'][number],
    { id: 2, name: 'Two', songs: 3, seconds: 400, seams: 2, ready: 0, waiting: 2, missing: 0, place: 1, to_render: 60 } as unknown as DraftList['drafts'][number],
  ],
  current: { name: 'Current', songs: 1, left: 0, eta: null as unknown as DraftList['current']['eta'] },
  out_of_room: false,
});

const now = (over: Partial<NowState> = {}): NowState => ({
  phase: 'playing', position: 0, songTime: 1, duration: 200, inSeam: false, seamAt: null, notice: '',
  nextReady: false, lastSeamKey: null, volume: 1, muted: false, ...over,
});

describe('rv2-d keepUnchanged never keeps a stale nested field', () => {
  it('a deep change inside one song replaces that song and the mix', () => {
    const before = data();
    const next = data();
    const deep = JSON.parse(JSON.stringify(next.mix[1]));
    deep.seam = { ...deep.seam, settings: { ...(deep.seam?.settings ?? {}), move: 'echo-out-deep' } };
    next.mix[1] = deep;
    const kept = keepUnchangedMix(before, next);
    expect(kept).not.toBe(before);
    expect(kept.mix[1]).toBe(deep);
    expect(kept.mix[0]).toBe(before.mix[0]);
  });

  it('a new mix array with equal contents is the very same object', () => {
    const before = data();
    expect(keepUnchangedMix(before, JSON.parse(JSON.stringify(before)))).toBe(before);
  });

  it('a draft field change and a change outside the drafts are both seen', () => {
    const before = drafts();
    const readied = keepUnchangedDrafts(before, drafts(2));
    expect(readied).not.toBe(before);
    expect(readied.drafts[0].ready).toBe(2);
    expect(readied.drafts[1]).toBe(before.drafts[1]);
    const roomy = keepUnchangedDrafts(before, { ...drafts(), current: { ...drafts().current, left: 4 } });
    expect(roomy.current.left).toBe(4);
    expect(roomy.drafts).toBe(before.drafts);
    expect(keepUnchangedDrafts(before, drafts())).toBe(before);
  });

  it('a reordered draft list says the new order', () => {
    const before = drafts();
    const next = drafts();
    next.drafts.reverse();
    const kept = keepUnchangedDrafts(before, next);
    expect(kept.drafts.map((draft) => draft.id)).toEqual([2, 1]);
    expect(kept.drafts[0]).toBe(before.drafts[1]);
  });

  it('a nested status count and a flag change are never kept stale', () => {
    const before = { counts: { music: 3 }, flags: { drafts: true } };
    expect(keepIfSame(before, { counts: { music: 3 }, flags: { drafts: false } }).flags.drafts).toBe(false);
    expect(keepIfSame(before, { counts: { music: 4 }, flags: { drafts: true } }).counts.music).toBe(4);
  });

  it('a list entry with a changed nested state is the new entry', () => {
    const a = { id: 1, state: { status: 'rendering' } };
    const kept = keepUnchangedItems([a], [{ id: 1, state: { status: 'ready' } }]);
    expect(kept[0]).not.toBe(a);
    expect(kept[0].state.status).toBe('ready');
  });
});

describe('rv2-d sameApartFromClock hides only the clock', () => {
  type P = { now: NowState; status: object; notify: () => void; tab?: string };
  const status = {};
  const notify = () => {};

  it('ignores a clock tick but sees every other prop change, callbacks included', () => {
    const same = sameApartFromClock<P>();
    const base: P = { now: now(), status, notify, tab: 'a' };
    expect(same(base, { ...base, now: now({ songTime: 2 }) })).toBe(true);
    expect(same(base, { ...base, status: {} })).toBe(false);
    expect(same(base, { ...base, notify: () => {} })).toBe(false);
    expect(same(base, { ...base, tab: 'b' })).toBe(false);
    expect(same(base, { now: base.now, status, notify })).toBe(false);
  });

  it("Mix's clock sees the playing song move and playback stop", () => {
    const same = sameApartFromClock<P>((value) => (value.phase === 'idle' ? -1 : value.position));
    const base: P = { now: now(), status, notify };
    expect(same(base, { ...base, now: now({ songTime: 9 }) })).toBe(true);
    expect(same(base, { ...base, now: now({ position: 1 }) })).toBe(false);
    expect(same(base, { ...base, now: now({ phase: 'idle' }) })).toBe(false);
  });
});
