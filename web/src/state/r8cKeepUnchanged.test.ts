import { describe, expect, it } from 'vitest';
import type { MixData } from '../api';
import { seam, songs } from '../test/backend';
import { keepIfSame, keepUnchangedItems, keepUnchangedMix } from './keepUnchanged';

const data = (): MixData => ({ mix: songs(seam('ready', 'a'), seam('rendering', 'b'), seam('none', 'c')), name: 'Mix', can_undo: false });

describe('r8c poll answers keep what is shown', () => {
  it('an identical mix answer is the very same object', () => {
    const before = data();
    expect(keepUnchangedMix(before, data())).toBe(before);
  });

  it('a changed seam replaces only its own song', () => {
    const before = data();
    const next = data();
    next.mix[2] = { ...next.mix[2], seam: seam('ready', 'b') };
    const kept = keepUnchangedMix(before, next);
    expect(kept).not.toBe(before);
    expect(kept.mix[0]).toBe(before.mix[0]);
    expect(kept.mix[1]).toBe(before.mix[1]);
    expect(kept.mix[2]).toBe(next.mix[2]);
    expect(kept.mix[3]).toBe(before.mix[3]);
  });

  it('a renamed mix keeps its songs but says the new name', () => {
    const before = data();
    const kept = keepUnchangedMix(before, { ...data(), name: 'Renamed' });
    expect(kept.name).toBe('Renamed');
    expect(kept.mix).toBe(before.mix);
  });

  it('same status keeps the old object, and list entries are matched by content', () => {
    const before = { counts: { total: 1 } };
    expect(keepIfSame(before, { counts: { total: 1 } })).toBe(before);
    expect(keepIfSame(before, { counts: { total: 2 } })).not.toBe(before);
    const a = { id: 1 };
    const b = { id: 2 };
    const kept = keepUnchangedItems([a, b], [{ id: 2 }, { id: 3 }]);
    expect(kept[0]).toBe(b);
    expect(kept[1]).toEqual({ id: 3 });
  });
});
