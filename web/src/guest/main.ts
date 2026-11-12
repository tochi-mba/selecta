// The guest page at /r/{code}: join a room, see what's playing, search and request songs, vote,
// follow your requests, and leave. No app, no account, and no audio: the host's speaker plays.
//
// It's its own tiny bundle (no React) so it loads fast on old phones and weak signal; the build
// fails if its JavaScript passes 100 KB. The guest token lives in an HttpOnly cookie the page
// can't read; the page only remembers which room id its code opened, to find its way back.

import { ApiError, call, h, replace, Song, songLength, songLine, store } from '../rooms/dom';
import './guest.css';

type Item = { request_id: string; song: Song | null; status: string; votes: number; nickname: string | null; voted: boolean; mine: boolean };
type Mine = { request_id: string; song: Song | null; status: string; text: string; votes: number };
type View = {
  room_name: string; room_status: string; guest_status: string; nickname: string;
  votes_on: boolean; requests_open: boolean; music_paused: boolean;
  now_playing: Song | null; up_next: Song[]; coming_up: Item[]; waiting: Item[]; my_requests: Mine[];
};

const POLL_MS = 5000;
const root = document.getElementById('guest') as HTMLElement;
const code = (location.pathname.split('/r/')[1] ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 8);
const roomKey = `selecta.guest.room.${code}`;
let roomId = store(roomKey);
let view: View | null = null;
let timer = 0;
let failures = 0;
let notice = '';
let searchSeq = 0;
// Every read of the room (a poll, a vote, a request) takes a ticket when it goes out. An answer older
// than the one on screen is dropped, so a slow poll can't undo a vote that was answered after it left.
let reads = 0;
let shownRead = 0;

function newer(ticket: number): boolean {
  if (ticket < shownRead) return false;
  shownRead = ticket;
  return true;
}

const shown = (text: string) => (text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4)}` : text);
const base = () => `/api/guest/rooms/${encodeURIComponent(roomId ?? '')}`;

function say(text: string): void {
  notice = text;
  const live = document.getElementById('g-notice');
  if (live) live.textContent = text;
}

function screen(title: string, text: string, ...extra: (Node | null)[]): void {
  window.clearTimeout(timer);
  replace(root, h('section', { className: 'g-card' }, h('p', { className: 'g-eyebrow' }, 'SELECTA ROOM'), h('h1', {}, title), h('p', {}, text), ...extra));
}

function joinScreen(error = ''): void {
  if (!code) {
    screen('No room code', 'Scan the QR code at the party, or type the link you were given.');
    return;
  }
  const button = h('button', { className: 'g-primary', type: 'button', onclick: () => void join(button as HTMLButtonElement) }, 'Join the room');
  screen(
    'Request a song',
    `You're joining room ${shown(code)}. You'll see what's playing and can ask for songs. Nothing plays on your phone.`,
    error ? h('p', { className: 'g-error', role: 'alert' }, error) : null,
    button,
    h('p', { className: 'g-small' }, 'Selecta keeps a random guest id, a scrambled form of your network address, your nickname and your requests, and deletes them 30 days after the room closes. No tracking, no account.'),
  );
  (button as HTMLButtonElement).focus();
}

async function join(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = 'Joining...';
  try {
    const joined = await call<{ room_id: string }>('/api/guest/join', { method: 'POST', body: JSON.stringify({ code }) });
    roomId = joined.room_id;
    store(roomKey, roomId);
    await refresh();
  } catch (error) {
    joinScreen((error as Error).message);
  }
}

function schedule(): void {
  window.clearTimeout(timer);
  const wait = Math.min(30_000, POLL_MS * 2 ** failures);
  timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); else schedule(); }, wait);
}

async function refresh(): Promise<void> {
  if (!roomId) { joinScreen(); return; }
  const asked = roomId;
  const ticket = ++reads;
  try {
    const fresh = await call<View>(base());
    // the guest left (or rejoined elsewhere) while this read was on its way: it no longer applies
    if (roomId !== asked) return;
    failures = 0;
    if (!newer(ticket)) { schedule(); return; }
    view = fresh;
    draw();
    if (view.room_status !== 'ended') schedule();
  } catch (error) {
    if (roomId !== asked) return;
    const problem = error as ApiError;
    if (problem.code === 'flag_off') { screen('Rooms are off', problem.message); return; }
    if (problem.status === 401) { store(roomKey, null); roomId = null; joinScreen(); return; }
    if (problem.code === 'banned') { store(roomKey, null); screen("You can't join this room", 'The host has removed you from this room.'); return; }
    if (problem.status === 410) { screen('This room has ended', 'Thanks for coming. The host has closed this room.'); return; }
    failures += 1;
    if (view) { draw(); say('The signal is weak. Trying again...'); } else screen('Connecting...', problem.message);
    schedule();
  }
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { className: 'g-section', 'aria-label': title }, h('h2', {}, title), ...children);
}

function songItem(song: Song | null, ...extra: (Node | string | null)[]): HTMLElement {
  return h('li', {}, h('span', { className: 'g-song' }, h('strong', {}, song?.title ?? 'A song'), h('span', { className: 'g-muted' }, song ? `${song.artist} · ${songLength(song.length_s)}` : '')), ...extra);
}

function voteButton(item: Item): HTMLElement | null {
  if (!view?.votes_on || item.mine) return null;
  const label = item.voted ? `Remove your vote for ${songLine(item.song)}` : `Vote for ${songLine(item.song)}`;
  return h('button', {
    type: 'button', className: 'g-vote', 'aria-pressed': String(item.voted), 'aria-label': label,
    onclick: () => void act(`${base()}/requests/${encodeURIComponent(item.request_id)}/vote`, item.voted ? 'DELETE' : 'POST'),
  }, `▲ ${item.votes}`);
}

async function act(path: string, method: string, body?: unknown, success = ''): Promise<void> {
  const ticket = ++reads;
  try {
    const answer = await call<View | { room: View }>(path, { method, body: body ? JSON.stringify(body) : undefined });
    if (newer(ticket)) {
      view = 'room' in answer ? answer.room : (answer as View);
      draw();
    }
    say(success);
  } catch (error) {
    say((error as Error).message);
    if ((error as ApiError).status === 401) void refresh();
  }
}

function shell(): Record<string, HTMLElement> {
  let found = document.getElementById('g-shell');
  if (!found) {
    found = h('div', { id: 'g-shell' },
      h('header', { className: 'g-head', id: 'g-head' }),
      h('p', { id: 'g-notice', className: 'g-notice', role: 'status' }, notice),
      h('div', { id: 'g-banners' }),
      h('div', { id: 'g-now' }),
      searchPanel(),
      h('div', { id: 'g-lists' }),
      h('div', { id: 'g-mine' }),
      h('p', {}, h('button', { type: 'button', className: 'g-quiet', onclick: () => void leave() }, 'Leave room')));
    replace(root, found);
  }
  const part = (id: string) => document.getElementById(id) as HTMLElement;
  return { head: part('g-head'), banners: part('g-banners'), now: part('g-now'), search: part('g-search'), lists: part('g-lists'), mine: part('g-mine') };
}

// Only the parts that change are redrawn, so a poll never takes focus or typing from the search.
function draw(): void {
  if (!view) return;
  const v = view;
  if (v.room_status === 'ended') {
    screen('This room has ended', 'Thanks for coming. The host has closed this room.', v.my_requests.length ? myRequests(v) : null);
    return;
  }
  const parts = shell();
  replace(parts.head,
    h('p', { className: 'g-eyebrow' }, 'SELECTA ROOM'),
    h('h1', {}, v.room_name),
    h('p', { className: 'g-muted' }, `You're ${v.nickname}. `, h('button', { type: 'button', className: 'g-link', onclick: () => void nicknames() }, 'Change nickname')));
  replace(parts.banners,
    v.guest_status === 'pending' ? h('p', { className: 'g-banner' }, "The host hasn't let you in yet. This page will update when they do.") : null,
    v.music_paused ? h('p', { className: 'g-banner' }, "The music's paused. Requests will wait until it starts again.") : null);
  const active = v.guest_status === 'active';
  replace(parts.now, active
    ? section('Now playing', v.now_playing ? h('p', { className: 'g-now' }, songLine(v.now_playing)) : h('p', { className: 'g-muted' }, 'Nothing is playing right now.'),
      v.up_next.length ? h('ol', { className: 'g-list' }, ...v.up_next.slice(0, 3).map((song) => songItem(song))) : null)
    : null);
  parts.search.hidden = !(active && v.requests_open);
  replace(parts.lists,
    active && !v.requests_open ? section('Requests', h('p', { className: 'g-muted' }, 'Requests are off in this room.')) : null,
    active && v.coming_up.length ? section('Coming up from guests', h('ol', { className: 'g-list' }, ...v.coming_up.map((item) => songItem(item.song, item.nickname ? h('span', { className: 'g-muted' }, item.nickname) : null, voteButton(item))))) : null,
    active && v.waiting.length ? section('Waiting for the host', h('ul', { className: 'g-list' }, ...v.waiting.map((item) => songItem(item.song, voteButton(item))))) : null);
  replace(parts.mine, myRequests(v));
}

function myRequests(v: View): HTMLElement {
  if (!v.my_requests.length) return section('My requests', h('p', { className: 'g-muted' }, "You haven't asked for anything yet."));
  return section('My requests', h('ul', { className: 'g-list' }, ...v.my_requests.map((item) => songItem(item.song,
    h('span', { className: `g-status g-${item.status}` }, item.text),
    item.status === 'sent' || item.status === 'accepted'
      ? h('button', { type: 'button', className: 'g-quiet', 'aria-label': `Withdraw ${songLine(item.song)}`, onclick: () => void act(`${base()}/requests/${encodeURIComponent(item.request_id)}`, 'DELETE', undefined, 'Request withdrawn.') }, 'Withdraw')
      : null))));
}

function searchPanel(): HTMLElement {
  const results = h('ul', { className: 'g-list', id: 'g-results' });
  const input = h('input', { id: 'g-q', type: 'search', autocomplete: 'off', enterkeyhint: 'search', placeholder: 'Title or artist', maxlength: 100 }) as HTMLInputElement;
  let wait = 0;
  input.addEventListener('input', () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(() => void search(input.value, results), 350);
  });
  return h('section', { className: 'g-section', id: 'g-search', 'aria-label': 'Request a song' },
    h('h2', {}, 'Request a song'),
    h('label', { for: 'g-q' }, 'Search the host\'s songs'),
    input,
    results);
}

async function search(query: string, results: HTMLElement): Promise<void> {
  const seq = ++searchSeq;
  if (query.trim().length < 2) { replace(results); return; }
  try {
    const found = await call<{ songs: Song[] }>(`${base()}/search?q=${encodeURIComponent(query.trim())}`);
    if (seq !== searchSeq) return;
    if (!found.songs.length) { replace(results, h('li', { className: 'g-muted' }, 'No songs match that.')); return; }
    replace(results, ...found.songs.map((song) => songItem(song, h('button', {
      type: 'button', className: 'g-primary g-small-button', 'aria-label': `Request ${songLine(song)}`,
      onclick: () => void request(song),
    }, 'Request'))));
  } catch (error) {
    if (seq === searchSeq) replace(results, h('li', { className: 'g-error' }, (error as Error).message));
  }
}

async function request(song: Song): Promise<void> {
  const ticket = ++reads;
  try {
    const sent = await call<{ became_vote: boolean; already_queued: boolean; room: View }>(`${base()}/requests`, { method: 'POST', body: JSON.stringify({ song_id: song.song_id }) });
    if (newer(ticket)) {
      view = sent.room;
      draw();
    }
    say(sent.became_vote ? 'Someone already asked for that, so it counts as your vote.' : sent.already_queued ? "That one's already coming up." : `Sent: ${song.title}.`);
  } catch (error) {
    say((error as Error).message);
  }
}

async function nicknames(): Promise<void> {
  try {
    const { nicknames: choices } = await call<{ nicknames: string[] }>(`${base()}/nicknames`);
    const close = () => { document.getElementById('g-shell')?.remove(); draw(); };
    screen('Pick a nickname', 'The host sees it. Other guests see it only if the host shows names.',
      h('div', { className: 'g-choices' }, ...choices.map((name) => h('button', { type: 'button', className: 'g-choice', onclick: () => void act(`${base()}/nickname`, 'PUT', { nickname: name }, `You're ${name} now.`).then(schedule) }, name))),
      h('button', { type: 'button', className: 'g-quiet', onclick: () => { close(); schedule(); } }, 'Keep my nickname'));
    (root.querySelector('.g-choice') as HTMLElement | null)?.focus();
  } catch (error) {
    say((error as Error).message);
  }
}

async function leave(): Promise<void> {
  try {
    await call(`${base()}/leave`, { method: 'POST' });
  } catch { /* leaving locally is enough if the server can't be reached */ }
  store(roomKey, null);
  roomId = null;
  view = null;
  screen('You left the room', 'The host still sees the songs you asked for.', h('button', { type: 'button', className: 'g-primary', onclick: () => joinScreen() }, 'Join again'));
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && roomId) void refresh(); });
void refresh();
