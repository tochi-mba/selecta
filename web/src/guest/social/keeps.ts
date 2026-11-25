// The songs a guest kept (ADR-0488): a list held on their own phone and nowhere else.
//
// Nothing here talks to the server. A heart saves the song the guest is looking at, under the
// room it was heard in, in this browser's storage. The guest has no account, so the list lives
// with the phone: it is still there when the room ends and when they scan the code again.
//
// Storage can be missing (a private window, a browser inside another app that blocks it). Then
// the list is kept for this visit only and `lasting()` says so, so the page can tell the guest
// once instead of losing their songs silently. Copying the list is the way out either way.
//
// It stays small by itself: 200 songs a room, 20 rooms, and rooms older than 90 days are
// dropped the next time the page opens.

import type { Song } from '../../rooms/dom';

export type Kept = { song_id: number; title: string; artist: string; at: number };
export type Shelf = { key: string; name: string; at: number; songs: Kept[] };
type Saved = { rooms: Record<string, Omit<Shelf, 'key'>> };

const KEY = 'selecta.guest.kept.v1';
export const MAX_SONGS = 200;
export const MAX_ROOMS = 20;
export const MAX_AGE_MS = 90 * 24 * 3600 * 1000;

let memory: Saved | null = null;
let storageWorks = true;

function read(): Saved {
  if (memory) return memory;
  let saved: Saved = { rooms: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Saved) : null;
    if (parsed && typeof parsed === 'object' && parsed.rooms && typeof parsed.rooms === 'object') saved = parsed;
  } catch {
    storageWorks = false;
  }
  memory = saved;
  return saved;
}

function write(saved: Saved): void {
  memory = saved;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    storageWorks = false;
  }
}

/** Whether the list outlives this visit. False once storage has refused a read or a write. */
export function lasting(): boolean {
  read();
  return storageWorks;
}

/** Drop rooms past their time and keep the newest `MAX_ROOMS`. Called once when the page opens. */
export function tidy(now = Date.now()): void {
  const saved = read();
  const fresh = Object.entries(saved.rooms)
    .filter(([, shelf]) => shelf.songs.length > 0 && now - shelf.at <= MAX_AGE_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ROOMS);
  if (fresh.length !== Object.keys(saved.rooms).length) write({ rooms: Object.fromEntries(fresh) });
}

export function shelf(key: string): Shelf | null {
  const found = read().rooms[key];
  return found ? { key, ...found } : null;
}

/** Every room with kept songs, newest first, leaving out `except` (the room on screen). */
export function shelves(except = ''): Shelf[] {
  return Object.entries(read().rooms)
    .filter(([key, found]) => key !== except && found.songs.length > 0)
    .map(([key, found]) => ({ key, ...found }))
    .sort((a, b) => b.at - a.at);
}

export function isKept(key: string, songId: number): boolean {
  return Boolean(read().rooms[key]?.songs.some((song) => song.song_id === songId));
}

/** Keep the song, or take it out if it is already kept. Returns whether it is kept now. */
export function toggle(key: string, roomName: string, song: Song, now = Date.now()): boolean {
  const saved = read();
  const found = saved.rooms[key] ?? { name: roomName, at: now, songs: [] };
  const had = found.songs.some((kept) => kept.song_id === song.song_id);
  const songs = had
    ? found.songs.filter((kept) => kept.song_id !== song.song_id)
    // newest first; past the cap the oldest goes
    : [{ song_id: song.song_id, title: song.title, artist: song.artist, at: now }, ...found.songs].slice(0, MAX_SONGS);
  write({ rooms: { ...saved.rooms, [key]: { name: roomName || found.name, at: had ? found.at : now, songs } } });
  return !had;
}

export function remove(key: string, songId: number): void {
  const saved = read();
  const found = saved.rooms[key];
  if (!found) return;
  write({ rooms: { ...saved.rooms, [key]: { ...found, songs: found.songs.filter((song) => song.song_id !== songId) } } });
}

/** The list as plain lines, one song each, for copying or sharing. */
export function asText(found: Shelf): string {
  const lines = found.songs.map((song) => (song.artist ? `${song.title} - ${song.artist}` : song.title));
  return [`Songs I liked at ${found.name}`, ...lines].join('\n');
}

/** For tests: forget what was read, so the next call reads storage again. */
export function forget(): void {
  memory = null;
  storageWorks = true;
}
