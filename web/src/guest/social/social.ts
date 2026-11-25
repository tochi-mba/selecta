// What a room does together, on a guest's phone (ADR-0488).
//
// The guest page (party rooms) and the venue page both use this. Each tells it where its room's
// API is and where this guest's kept songs are filed, then asks it for the pieces to draw: what
// to add to the Now playing card, and the sections that sit below the requests.
//
// The phone is always complete. Whether a big screen is showing only changes a few words.
//
// What changes by the second (the count of hearts, a vote and its tally) comes from the room's
// pulse, a small answer every phone in the room shares, read every two seconds while the page
// is on screen. What only this guest sees (their own heart, their own vote) is drawn at once
// when they tap, and confirmed by the page's own five-second read.

import { ApiError, call, h, Song, songLine } from '../../rooms/dom';
import { icon } from '../parts';
import * as keeps from './keeps';

export type Features = { keeps?: boolean; reactions?: boolean; rounds?: boolean; dedications?: boolean; recap?: boolean };
export type Play = { play_id: string; song_id: number; started_at: number; loves: number; blends: number; blend: { from: Song | null; until: number } | null };
export type Pulse = {
  now: number; live: boolean; screen: boolean; features: Features; shows: Features;
  song: Song | null; paused: boolean; play: Play | null;
  /** Guests whose pages are open, and whether enough of them loved the blend to say so. */
  online?: number; blend_loved?: boolean;
};
export type Kind = 'love' | 'blend';
/** The parts of a room view this module reads; both pages' views have them. */
export type RoomView = {
  room_name: string; now_playing: Song | null; screen?: boolean; social?: Features;
  /** This guest's own taps on the last two plays: play id to the kinds they tapped. */
  my_taps?: Record<string, Kind[]>;
};

export type Host = {
  /** The guest API for this room, with no trailing slash. */
  base: () => string;
  /** Where this guest's kept songs for this room are filed. */
  shelf: () => string;
  redraw: () => void;
  say: (text: string) => void;
  buzz: (ms: number) => void;
};

const PULSE_MS = 2000;
const MAX_WAIT_MS = 15_000;

let host: Host | null = null;
let pulse: Pulse | null = null;
let timer = 0;
let failures = 0;
let reading = false;
let toldStorage = false;

export function init(next: Host): void {
  host = next;
  keeps.tidy();
}

export const features = (view: RoomView | null): Features => view?.social ?? {};
export const currentPulse = (): Pulse | null => pulse;

/** Is a big screen showing now? The pulse knows soonest; the page's own read is the fallback. */
export const screenOn = (view: RoomView | null): boolean => pulse?.screen ?? view?.screen ?? false;

function needsPulse(on: Features): boolean {
  return Boolean(on.reactions || on.rounds || on.dedications);
}

/** Keep the pulse going while the room offers something that moves, and stop it when not. */
export function sync(view: RoomView | null, live: boolean): void {
  if (!host || !live || !needsPulse(features(view))) { stop(); return; }
  if (!timer && !reading) void read();
}

export function stop(): void {
  window.clearTimeout(timer);
  timer = 0;
  pulse = null;
  failures = 0;
}

function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    if (document.visibilityState === 'visible') void read(); else schedule();
  }, Math.min(MAX_WAIT_MS, PULSE_MS * 2 ** failures));
}

async function read(): Promise<void> {
  if (!host || reading) return;
  reading = true;
  try {
    pulse = await call<Pulse>(`${host.base()}/pulse`);
    failures = 0;
    host.redraw();
  } catch (error) {
    // The page's own read says what went wrong with the room; the pulse only backs off.
    failures += 1;
    if ((error as ApiError).status === 401 || (error as ApiError).status === 403 || (error as ApiError).status === 410) { reading = false; stop(); return; }
  }
  reading = false;
  if (host) schedule();
}

/** Ask for a fresh pulse now, after this guest tapped something. */
export function soon(): void {
  if (!host || !timer) return;
  window.clearTimeout(timer);
  timer = 0;
  void read();
}

// --- Keep the songs you liked -------------------------------------------------------------

function toggleKeep(view: RoomView, song: Song): void {
  if (!host) return;
  const kept = keeps.toggle(host.shelf(), view.room_name, song);
  host.buzz(8);
  if (kept && !keeps.lasting() && !toldStorage) {
    toldStorage = true;
    host.say('Saved. Your songs stay only while this page is open, so copy the list before you go.');
  } else {
    host.say(kept ? 'Saved to your songs.' : 'Taken out of your songs.');
  }
  host.redraw();
}

// --- Reactions ----------------------------------------------------------------------------

// A tap shows at once, before the server answers: "play id:kind" to the choice just made.
const tapping = new Map<string, boolean>();

/** The play the pulse is on, when it is the song the page shows; else there is nothing to tap. */
function playFor(song: Song): Play | null {
  return pulse?.play && pulse.play.song_id === song.song_id ? pulse.play : null;
}

function tapped(view: RoomView, play: Play, kind: Kind): boolean {
  return tapping.get(`${play.play_id}:${kind}`) ?? Boolean(view.my_taps?.[play.play_id]?.includes(kind));
}

/** The room's count with this guest's own tap already in it, while the server is being asked. */
function shownCount(view: RoomView, play: Play, kind: Kind): number {
  const count = kind === 'love' ? play.loves : play.blends;
  const choice = tapping.get(`${play.play_id}:${kind}`);
  const known = Boolean(view.my_taps?.[play.play_id]?.includes(kind));
  return Math.max(0, count + (choice === undefined || choice === known ? 0 : choice ? 1 : -1));
}

async function tap(view: RoomView, play: Play, kind: Kind, song: Song): Promise<void> {
  if (!host) return;
  const key = `${play.play_id}:${kind}`;
  if (tapping.has(key)) return;
  const next = !tapped(view, play, kind);
  tapping.set(key, next);
  host.buzz(8);
  // A love also keeps the song on this phone, when the room offers that: one heart, one meaning.
  if (kind === 'love' && features(view).keeps && keeps.isKept(host.shelf(), song.song_id) !== next) keeps.toggle(host.shelf(), view.room_name, song);
  host.redraw();
  try {
    const answer = await call<{ pulse: Pulse }>(`${host.base()}/reactions`, { method: next ? 'POST' : 'DELETE', body: JSON.stringify({ kind, play_id: play.play_id }) });
    pulse = answer.pulse;
    // the page's own read confirms it within five seconds; until then the choice stands
    const mine = new Set(view.my_taps?.[play.play_id] ?? []);
    if (next) mine.add(kind); else mine.delete(kind);
    view.my_taps = { ...view.my_taps, [play.play_id]: [...mine] };
  } catch (error) {
    // The song moved on under the tap: say nothing, and show the song that is on now.
    if ((error as ApiError).code !== 'song_changed') host.say((error as Error).message);
    soon();
  }
  tapping.delete(key);
  host.redraw();
}

/** The heart on the Now playing card. With reactions on it is the room's love for the song,
 * with its count; with only "keep" on it saves the song on this phone. */
function heart(view: RoomView, song: Song): HTMLElement {
  const on = features(view);
  const play = on.reactions ? playFor(song) : null;
  if (play) {
    const loved = tapped(view, play, 'love');
    const count = shownCount(view, play, 'love');
    return h('button', {
      type: 'button', className: 'g-heart', 'data-key': 'heart', 'aria-pressed': String(loved),
      'aria-label': `${loved ? 'Take back your love for' : 'Love'} ${songLine(song)}. ${count === 1 ? '1 love' : `${count} loves`} in the room.`,
      onclick: () => void tap(view, play, 'love', song),
    }, icon('heart'), h('span', { className: 'g-heart-word' }, String(count)));
  }
  const kept = host ? keeps.isKept(host.shelf(), song.song_id) : false;
  return h('button', {
    type: 'button', className: 'g-heart', 'data-key': 'heart', 'aria-pressed': String(kept),
    'aria-label': kept ? `Take ${songLine(song)} out of your songs` : `Keep ${songLine(song)}`,
    onclick: () => toggleKeep(view, song),
  }, icon('heart'), h('span', { className: 'g-heart-word' }, kept ? 'Kept' : 'Keep'));
}

/** The blend into the playing song, while it is fresh: one tap says the change was a good one. */
function blend(view: RoomView, song: Song): HTMLElement | null {
  const play = features(view).reactions ? playFor(song) : null;
  const from = play?.blend?.from;
  if (!play || !from) return null;
  const loved = tapped(view, play, 'blend');
  return h('button', {
    type: 'button', className: 'g-heart g-blend', 'data-key': 'blend', 'aria-pressed': String(loved),
    'aria-label': `${loved ? 'Take back your love for' : 'Love'} the blend from ${from.title} into ${song.title}`,
    onclick: () => void tap(view, play, 'blend', song),
  }, loved ? 'Loved the blend' : 'Love that blend');
}

/** What the room adds to the Now playing card, under the song: nothing when nothing is on. */
export function hero(view: RoomView): HTMLElement | null {
  const on = features(view);
  const song = view.now_playing;
  // with only reactions on, the heart needs a play to belong to; until the pulse has one, wait
  if (!song || !(on.keeps || (on.reactions && playFor(song)))) return null;
  const play = playFor(song);
  return h('div', { className: 'g-hero-acts', 'data-key': 'hero-acts' },
    heart(view, song),
    blend(view, song),
    // said on every phone, so a room with no big screen hears it too
    on.reactions && play && pulse?.blend_loved ? h('span', { className: 'g-loved', 'data-key': 'loved', role: 'status' }, 'The room loved that blend') : null);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // an older phone, or a page not allowed the clipboard: the selection-and-copy way
    const box = h('textarea', { className: 'g-offscreen', readonly: true }) as HTMLTextAreaElement;
    box.value = text;
    document.body.append(box);
    box.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    box.remove();
    return done;
  }
}

async function copyShelf(found: keeps.Shelf): Promise<void> {
  const done = await copy(keeps.asText(found));
  host?.say(done ? 'List copied.' : 'Couldn’t copy the list here. Press and hold a song to copy it.');
}

async function shareShelf(found: keeps.Shelf): Promise<void> {
  try {
    await navigator.share({ text: keeps.asText(found) });
  } catch { /* the guest closed the share sheet: nothing to say */ }
}

function keptRow(found: keeps.Shelf, song: keeps.Kept, removable: boolean): HTMLElement {
  return h('li', { className: 'g-item g-kept-item', 'data-key': `kept-${song.song_id}` },
    h('span', { className: 'g-kept-mark', 'aria-hidden': 'true' }, icon('heart')),
    h('span', { className: 'g-song' }, h('strong', {}, song.title || 'A song'), song.artist ? h('span', { className: 'g-meta' }, song.artist) : null),
    removable ? h('button', {
      type: 'button', className: 'g-quiet g-small-button', 'aria-label': `Take ${song.title || 'this song'} out of your songs`,
      onclick: () => { keeps.remove(found.key, song.song_id); host?.say('Taken out of your songs.'); host?.redraw(); },
    }, 'Remove') : null);
}

function shelfActions(found: keeps.Shelf): HTMLElement {
  return h('p', { className: 'g-kept-acts' },
    h('button', { type: 'button', className: 'g-quiet g-small-button', onclick: () => void copyShelf(found) }, 'Copy list'),
    typeof navigator.share === 'function' ? h('button', { type: 'button', className: 'g-quiet g-small-button', onclick: () => void shareShelf(found) }, 'Share') : null);
}

function shelfSection(found: keeps.Shelf, title: string, removable: boolean): HTMLElement {
  return h('section', { className: 'g-section g-kept', 'aria-label': title, 'data-key': `kept-${found.key}` },
    h('h2', {}, title, h('span', { className: 'g-tally' }, String(found.songs.length))),
    h('ul', { className: 'g-list' }, ...found.songs.map((song) => keptRow(found, song, removable))),
    shelfActions(found),
    h('p', { className: 'g-small' }, keeps.lasting() ? 'Saved on this phone, in this browser.' : 'Your songs stay only while this page is open.'));
}

/** "Your songs" for the room on screen: nothing until the guest has kept one. */
export function kept(view: RoomView): HTMLElement | null {
  if (!host || !features(view).keeps) return null;
  const found = keeps.shelf(host.shelf());
  return found && found.songs.length ? shelfSection(found, 'Your songs', true) : null;
}

/** After the room has ended: the songs kept in it, whatever the room offered at the end. */
export function keptAfter(shelfKey: string, roomName: string): HTMLElement | null {
  const found = keeps.shelf(shelfKey);
  return found && found.songs.length ? shelfSection(found, `Your songs from ${found.name || roomName}`, true) : null;
}

/** Songs kept in earlier rooms on this phone, for the screens before a guest is in a room. */
export function earlier(): HTMLElement | null {
  const found = keeps.shelves();
  if (!found.length) return null;
  return h('details', { className: 'g-keeps g-earlier' },
    h('summary', {}, 'Songs you kept before'),
    ...found.slice(0, 5).map((one) => shelfSection(one, one.name || 'A room', true)));
}
