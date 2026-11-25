import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as keeps from './keeps';

// The songs a guest kept (ADR-0488, RS-0488-04): held on the phone, by room, and nowhere else.

const song = (id: number, artist = `Artist ${id}`) => ({ song_id: id, title: `Song ${id}`, artist, length_s: 200 });

describe('kept songs', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    keeps.forget();
  });

  it('keeps a song under its room, and a second tap takes it out', () => {
    expect(keeps.toggle('room-1', 'Party', song(1), 1000)).toBe(true);
    expect(keeps.isKept('room-1', 1)).toBe(true);
    expect(keeps.isKept('room-2', 1)).toBe(false);
    expect(keeps.shelf('room-1')?.songs.map((kept) => kept.title)).toEqual(['Song 1']);
    expect(keeps.toggle('room-1', 'Party', song(1), 2000)).toBe(false);
    expect(keeps.isKept('room-1', 1)).toBe(false);
  });

  it('survives a reload, because it is in this browser’s storage', () => {
    keeps.toggle('room-1', 'Party', song(1));
    keeps.forget();
    expect(keeps.isKept('room-1', 1)).toBe(true);
    expect(keeps.lasting()).toBe(true);
  });

  it('lists the newest first and never more than the cap', () => {
    for (let id = 1; id <= keeps.MAX_SONGS + 5; id += 1) keeps.toggle('room-1', 'Party', song(id), id);
    const kept = keeps.shelf('room-1')?.songs ?? [];
    expect(kept).toHaveLength(keeps.MAX_SONGS);
    expect(kept[0].song_id).toBe(keeps.MAX_SONGS + 5);
  });

  it('says the list as plain lines for copying', () => {
    keeps.toggle('room-1', 'Party', song(1), 1);
    keeps.toggle('room-1', 'Party', { ...song(2), artist: '' }, 2);
    const found = keeps.shelf('room-1');
    expect(found && keeps.asText(found)).toBe('Songs I liked at Party\nSong 2\nSong 1 - Artist 1');
  });

  it('drops rooms older than ninety days and keeps the newest twenty', () => {
    const now = 200 * 24 * 3600 * 1000;
    keeps.toggle('old', 'Long ago', song(1), now - keeps.MAX_AGE_MS - 1);
    for (let room = 0; room < keeps.MAX_ROOMS + 3; room += 1) keeps.toggle(`room-${room}`, `Room ${room}`, song(room + 10), now - room);
    keeps.tidy(now);
    const left = keeps.shelves();
    expect(left).toHaveLength(keeps.MAX_ROOMS);
    expect(left.some((found) => found.key === 'old')).toBe(false);
    expect(left[0].key).toBe('room-0');
    expect(keeps.shelves('room-0').some((found) => found.key === 'room-0')).toBe(false);
  });

  it('keeps for this visit and says so when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(keeps.toggle('room-1', 'Party', song(1))).toBe(true);
    expect(keeps.isKept('room-1', 1)).toBe(true);
    expect(keeps.lasting()).toBe(false);
  });

  it('removes one song and leaves the rest', () => {
    keeps.toggle('room-1', 'Party', song(1));
    keeps.toggle('room-1', 'Party', song(2));
    keeps.remove('room-1', 1);
    expect(keeps.shelf('room-1')?.songs.map((kept) => kept.song_id)).toEqual([2]);
  });
});
