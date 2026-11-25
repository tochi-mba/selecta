import { describe, expect, it } from 'vitest';
import { OFFERED, pickCandidates } from './roundCandidates';

// Which songs the room is offered when it votes for the next one (ADR-0488, RS-0488-07).

const pool = (ids: number[], artist?: (id: number) => string) => ids.map((id) => ({ song_id: id, artist: artist ? artist(id) : `Artist ${id}` }));
const none = () => 0;

describe('the songs a vote offers', () => {
  it('offers three, never the playing song or one to avoid', () => {
    const picked = pickCandidates({ pool: pool([1, 2, 3, 4, 5, 6]), from: 1, avoid: [2], random: none });
    expect(picked).toHaveLength(OFFERED);
    expect(picked).not.toContain(1);
    expect(picked).not.toContain(2);
  });

  it('puts a measured harmonic match for the playing song first', () => {
    const picked = pickCandidates({ pool: pool([2, 3, 4, 5]), from: 1, pairs: [{ song_a: 5, song_b: 1 }], random: none });
    expect(picked[0]).toBe(5);
  });

  it('favours a blend rooms loved, then a song rooms loved', () => {
    const marks = [
      { song_id: 1, next_song_id: 4, rooms: 2 },
      { song_id: 3, next_song_id: null, rooms: 3 },
      { song_id: 9, next_song_id: 2, rooms: 9 }, // a blend from another song says nothing here
    ];
    const picked = pickCandidates({ pool: pool([2, 3, 4, 5]), from: 1, marks, random: none });
    expect(picked.slice(0, 2)).toEqual([4, 3]);
  });

  it('spreads across artists while there are enough songs to', () => {
    const picked = pickCandidates({ pool: pool([2, 3, 4, 5], (id) => (id < 4 ? 'Same; Guest' : `Artist ${id}`)), from: 1, random: none });
    expect(picked.filter((id) => id < 4)).toHaveLength(1);
    const few = pickCandidates({ pool: pool([2, 3], () => 'Same'), from: 1, random: none });
    expect(few).toEqual([2, 3]);
  });

  it('is chance alone when nothing is known, and empty when nothing can be offered', () => {
    const first = pickCandidates({ pool: pool([2, 3, 4, 5]), from: 1, random: () => 0.9, count: 2 });
    expect(first).toHaveLength(2);
    expect(pickCandidates({ pool: [], from: 1 })).toEqual([]);
  });
});
