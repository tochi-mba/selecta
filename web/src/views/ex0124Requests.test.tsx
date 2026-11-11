import { describe, expect, it } from 'vitest';
import { RequestRow, requestWords } from './Requests';

/** EX-0124-01 (Experience programme, Requests): each actual request stage reads differently, and every
 * stage that is stuck says why and what would let it move, without promising a play time. */

const STAGES = ['adding', 'unavailable', 'never', 'in_mix', 'analysing', 'no_cues', 'no_mix', 'waiting', 'searching', 'approve', 'preparing', 'ready'] as const;
const row = (more: Partial<RequestRow> = {}): RequestRow => ({
  id: 1, song_id: 9, title: 'Asked For', artist: 'Someone', status: 'waiting', available: 1, after: 'Song 2',
  route: [{ id: 8, title: 'Bridge Song' }, { id: 9, title: 'Asked For' }], ...more,
});

describe('EX-0124-01 a truthful word for every request stage', () => {
  it('no two stages read the same', () => {
    const words = STAGES.map((stage) => requestWords(row(), stage as never));
    const shown = words.map((word) => `${word.label}|${word.detail}`);
    expect(new Set(shown).size).toBe(STAGES.length);
    for (const word of words) {
      expect(word.label.trim()).not.toBe('');
      expect(word.detail.trim()).not.toBe('');
    }
  });

  it('every stuck stage gives a reason and a way forward', () => {
    for (const stage of ['unavailable', 'never', 'no_cues'] as const) {
      const word = requestWords(row(), stage as never);
      expect(word.tone).toBe('stuck');
      expect(word.detail).toMatch(/because|can’t|so |Change that|won’t/);
    }
    expect(requestWords(row(), 'no_mix' as never).detail).toMatch(/Start a mix/);
    expect(requestWords(row({ bridge_lost: true }), 'searching' as never).detail).toMatch(/Find another/);
  });

  it('asking for a bridge names each extra song, and nothing promises a play time', () => {
    expect(requestWords(row(), 'approve' as never).detail).toContain('Bridge Song');
    for (const stage of STAGES) {
      const { detail } = requestWords(row({ seconds: 120 }), stage as never);
      expect(detail).not.toMatch(/will play at|plays at|guaranteed to play/i);
    }
    expect(requestWords(row(), 'ready' as never).detail).toMatch(/not guaranteed/);
    expect(requestWords(row({ seconds: 120 }), 'preparing' as never).detail).toMatch(/not a scheduled play time/);
  });
});
