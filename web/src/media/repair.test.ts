import { describe, expect, it } from 'vitest';
import type { TrackIdentity } from './identity';
import { acceptReimport, anyPlayable, planRepair } from './repair';
import type { StoredSong } from './store';

const identity = (n: number): TrackIdentity => ({ content_sha256: `hash-${n}`, title: `Track ${n}`, artist: 'Test Artist', duration_s: 100 + n });

const local = (n: number, songId = n): StoredSong => ({
  songId,
  identity: identity(n),
  ref: { kind: 'repick', name: `track-${n}.mp3`, size: 3 },
  importedAt: 1700000000000,
});

describe('planRepair', () => {
  it('opens the ADR\'s 5-of-8 case as a repair plan, not an error', () => {
    const recipe = [1, 2, 3, 4, 5, 6, 7, 8].map(identity);
    const plan = planRepair(recipe, [local(2), local(5), local(8)]);
    expect(plan.matched.map((match) => match.songId)).toEqual([2, 5, 8]);
    expect(plan.missing).toHaveLength(5);
    expect(plan.missing.map((item) => item.identity.title)).toEqual(['Track 1', 'Track 3', 'Track 4', 'Track 6', 'Track 7']);
    for (const item of plan.missing) expect(item.reason).toBe('not_imported');
    expect(anyPlayable(plan)).toBe(true);
  });

  it('matches by content hash, so tags may lie and a renamed file still resolves', () => {
    const renamed: StoredSong = { ...local(1), identity: { ...identity(1), title: 'Totally Different Name' } };
    const plan = planRepair([identity(1)], [renamed]);
    expect(plan.matched).toHaveLength(1);
    expect(plan.missing).toHaveLength(0);
  });

  it('marks tracks with lapsed handles as needs_regrant, not re-import', () => {
    const plan = planRepair([identity(1), identity(2)], [local(1), local(2)], new Set([2]));
    expect(plan.matched.map((match) => match.songId)).toEqual([1]);
    expect(plan.missing).toEqual([{ identity: identity(2), reason: 'needs_regrant' }]);
  });

  it('is honestly empty-handed on a fresh device', () => {
    const plan = planRepair([identity(1)], []);
    expect(plan.matched).toEqual([]);
    expect(plan.missing).toEqual([{ identity: identity(1), reason: 'not_imported' }]);
    expect(anyPlayable(plan)).toBe(false);
  });
});

describe('acceptReimport', () => {
  it('re-matches re-imported files by content hash, completing the 5-of-8 repair', () => {
    const recipe = [1, 2, 3, 4, 5, 6, 7, 8].map(identity);
    const before = planRepair(recipe, [local(2), local(5), local(8)]);
    const reimported = [1, 3, 4, 6, 7].map((n) => ({ content_sha256: `hash-${n}`, song_id: 100 + n }));
    const after = acceptReimport(before, reimported);
    expect(after.missing).toEqual([]);
    expect(after.matched).toHaveLength(8);
    expect(after.matched.find((match) => match.identity.content_sha256 === 'hash-3')?.songId).toBe(103);
  });

  it('keeps whatever was not re-imported honestly missing', () => {
    const before = planRepair([identity(1), identity(2)], []);
    const after = acceptReimport(before, [{ content_sha256: 'hash-1', song_id: 11 }]);
    expect(after.matched.map((match) => match.songId)).toEqual([11]);
    expect(after.missing).toEqual([{ identity: identity(2), reason: 'not_imported' }]);
  });

  it('never touches the already matched tracks', () => {
    const before = planRepair([identity(1)], [local(1)]);
    const after = acceptReimport(before, []);
    expect(after).toEqual(before);
  });
});
