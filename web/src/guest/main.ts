// The guest page at /r/{code}: join a room, see what's playing, search and request songs, vote,
// follow your requests, and leave. No app, no account, and no audio: the host's speaker plays.
//
// It's its own tiny bundle (no React) so it loads fast on old phones and weak signal; the build
// fails if its JavaScript passes 100 KB. The guest token lives in an HttpOnly cookie the page
// can't read; the page only remembers which room id its code opened, to find its way back.
//
// A guest can choose several songs and send them together. The page says how many more they can
// add ("You can add 2 more"), and when the room's limit is reached it says which limit and when
// it frees up, in the server's own words (`limit_text`). The server decides what is added: each
// song of a batch comes back added or with its reason.
//
// Each read of the room also tells the host this guest is here, so the page reads it every 5 s
// while it's on screen. If the signal or the server drops, it says "Reconnecting..." and keeps
// trying (backing off to 15 s, and at once when the phone comes back online), with the same
// cookie, so the guest is back in the room by themselves. There's no leave-on-close beacon: a
// reload or a phone switching apps fires the same events, and leaving would put them out.

import { ApiError, call, h, patch, replace, Song, songLength, songLine, store } from '../rooms/dom';
import './guest.css';

type Item = { request_id: string; song: Song | null; status: string; votes: number; nickname: string | null; voted: boolean; mine: boolean };
type Mine = { request_id: string; song: Song | null; status: string; text: string; votes: number };
type View = {
  room_name: string; room_status: string; guest_status: string; nickname: string;
  votes_on: boolean; requests_open: boolean; music_paused: boolean;
  now_playing: Song | null; up_next: Song[]; coming_up: Item[]; waiting: Item[]; my_requests: Mine[];
  nickname_confirm?: boolean;
  /** How many more songs this guest can ask for now; at 0, `limit_text` says why and until when. */
  requests_left?: number; limit_text?: string;
};
type Sent = { song_id: number; added: boolean; became_vote?: boolean; already_queued?: boolean; message?: string };

const POLL_MS = 5000;
const MAX_WAIT_MS = 15_000;
const RECONNECTING = 'Reconnecting...';
const root = document.getElementById('guest') as HTMLElement;
const code = (location.pathname.split('/r/')[1] ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 8);
const roomKey = `selecta.guest.room.${code}`;
let roomId = store(roomKey);
let view: View | null = null;
let timer = 0;
let failures = 0;
let notice = '';
let searchSeq = 0;
// the songs chosen but not sent yet, and the last search answer they were chosen from
let basket: Song[] = [];
let found: Song[] = [];
let sending = false;
const songsWord = (count: number) => (count === 1 ? '1 song' : `${count} songs`);
// a server that doesn't say (an older one) leaves the choosing open and still enforces its limits
const leftNow = () => view?.requests_left ?? 99;
// Every read of the room (a poll, a vote, a request) takes a ticket when it goes out. An answer older
// than the one on screen is dropped, so a slow poll can't undo a vote that was answered after it left.
let reads = 0;
let shownRead = 0;

// ADR-0422 (rooms.nickname_confirm, said by the server in each view): a nickname save shows as
// saving, saved or not saved. `nameEpoch` goes up when a save goes out and when it's answered, so
// a poll that overlapped a save is dropped (it can't know whether the new name was in yet), and a
// write sent before the save was answered keeps the confirmed name rather than its stale copy.
type NameSave = { state: 'saving' | 'saved' | 'failed'; name: string; error?: string };
let nameSave: NameSave | null = null;
let nameEpoch = 0;
let savingName = false;
let confirmedName: { name: string; epoch: number } | null = null;
let picking = false;
const confirming = () => view?.nickname_confirm === true;

function adopt(fresh: View, epoch: number): View {
  return confirmedName && epoch < confirmedName.epoch ? { ...fresh, nickname: confirmedName.name } : fresh;
}

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
  replace(root, h('section', { className: 'g-card' }, h('p', { className: 'g-eyebrow' }, 'SelectaDJ room'), h('h1', {}, title), h('p', {}, text), ...extra));
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
    h('p', { className: 'g-small' }, 'SelectaDJ keeps a random guest id, a scrambled form of your network address, your nickname and your requests, and deletes them 30 days after the room closes. No tracking, no account.'),
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
  const wait = Math.min(MAX_WAIT_MS, POLL_MS * 2 ** failures);
  timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); else schedule(); }, wait);
}

async function refresh(): Promise<void> {
  if (!roomId) { joinScreen(); return; }
  const asked = roomId;
  const ticket = ++reads;
  const epoch = nameEpoch;
  const overlapped = savingName;
  try {
    const fresh = await call<View>(base());
    // the guest left (or rejoined elsewhere) while this read was on its way: it no longer applies
    if (roomId !== asked) return;
    const wasDown = failures > 0;
    failures = 0;
    if (wasDown && notice === RECONNECTING) say('Back in the room.');
    if ((confirming() || fresh.nickname_confirm) && (overlapped || epoch !== nameEpoch)) { schedule(); return; }
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
    if (view) { draw(); say(RECONNECTING); } else screen(RECONNECTING, problem.message);
    schedule();
  }
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { className: 'g-section', 'aria-label': title, 'data-key': title }, h('h2', {}, title), ...children);
}

function songItem(song: Song | null, key: string | undefined, ...extra: (Node | string | null)[]): HTMLElement {
  return h('li', { 'data-key': key }, h('span', { className: 'g-song' }, h('strong', {}, song?.title ?? 'A song'), h('span', { className: 'g-muted' }, song ? `${song.artist} · ${songLength(song.length_s)}` : '')), ...extra);
}

function voteButton(item: Item): HTMLElement | null {
  if (!view?.votes_on || item.mine) return null;
  const label = item.voted ? `Remove your vote for ${songLine(item.song)}` : `Vote for ${songLine(item.song)}`;
  return h('button', {
    type: 'button', className: 'g-vote', 'aria-pressed': String(item.voted), 'aria-label': label,
    onclick: () => void act(`${base()}/requests/${encodeURIComponent(item.request_id)}/vote`, item.voted ? 'DELETE' : 'POST'),
  }, String(item.votes));
}

async function act(path: string, method: string, body?: unknown, success = ''): Promise<void> {
  const ticket = ++reads;
  const epoch = nameEpoch;
  try {
    const answer = await call<View | { room: View }>(path, { method, body: body ? JSON.stringify(body) : undefined });
    if (newer(ticket)) {
      view = adopt('room' in answer ? answer.room : (answer as View), epoch);
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

// Only the parts that change are redrawn, and those are patched in place (keyed by request), so a
// poll never takes focus from a Vote or Withdraw button, nor typing from the search.
function draw(): void {
  if (!view) return;
  // ADR-0422: a poll landing while the guest is picking a nickname mustn't close the picker
  if (picking && confirming()) return;
  const v = view;
  if (v.room_status === 'ended') {
    screen('This room has ended', 'Thanks for coming. The host has closed this room.', v.my_requests.length ? myRequests(v) : null);
    return;
  }
  const parts = shell();
  patch(parts.head,
    h('p', { className: 'g-eyebrow' }, 'SelectaDJ room'),
    h('h1', {}, v.room_name),
    v.nickname_confirm ? nameLine(v) : h('p', { className: 'g-muted' }, `You're ${v.nickname}. `, h('button', { type: 'button', className: 'g-link', onclick: () => void nicknames() }, 'Change nickname')),
    v.nickname_confirm && nameSave?.state === 'failed' ? h('p', { className: 'g-error', role: 'alert' }, `${nameSave.name} wasn't saved. ${nameSave.error ?? ''}`.trim(), ' ', h('button', { type: 'button', className: 'g-link', onclick: () => void saveNickname(nameSave?.name ?? '') }, 'Try again')) : null);
  patch(parts.banners,
    v.guest_status === 'pending' ? h('p', { className: 'g-banner' }, "The host hasn't let you in yet. This page will update when they do.") : null,
    v.music_paused ? h('p', { className: 'g-banner' }, "Nothing is playing right now. You can still ask for songs: the host sees each one and adds it to the mix.") : null);
  const active = v.guest_status === 'active';
  patch(parts.now, active
    ? section('Now playing', v.now_playing ? h('p', { className: 'g-now' }, songLine(v.now_playing)) : h('p', { className: 'g-muted' }, 'Nothing is playing right now.'),
      v.up_next.length ? h('ol', { className: 'g-list' }, ...v.up_next.slice(0, 3).map((song, index) => songItem(song, `next-${index}-${song.song_id}`))) : null)
    : null);
  parts.search.hidden = !(active && v.requests_open);
  if (!parts.search.hidden) { drawResults(); drawBasket(); }
  patch(parts.lists,
    active && !v.requests_open ? section('Requests', h('p', { className: 'g-muted' }, 'Requests are off in this room.')) : null,
    active && v.coming_up.length ? section('Coming up from guests', h('ol', { className: 'g-list' }, ...v.coming_up.map((item) => songItem(item.song, item.request_id, item.nickname ? h('span', { className: 'g-muted' }, item.nickname) : null, voteButton(item))))) : null,
    active && v.waiting.length ? section('Waiting for the host', h('ul', { className: 'g-list' }, ...v.waiting.map((item) => songItem(item.song, item.request_id, voteButton(item))))) : null);
  patch(parts.mine, myRequests(v));
}

function myRequests(v: View): HTMLElement {
  if (!v.my_requests.length) return section('My requests', h('p', { className: 'g-muted' }, "You haven't asked for anything yet."));
  return section('My requests', h('ul', { className: 'g-list' }, ...v.my_requests.map((item) => songItem(item.song, item.request_id,
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
    results,
    h('div', { id: 'g-basket' }));
}

function chosen(song: Song): boolean {
  return basket.some((one) => one.song_id === song.song_id);
}

function choose(song: Song): void {
  basket = chosen(song) ? basket.filter((one) => one.song_id !== song.song_id) : [...basket, song];
  drawResults();
  drawBasket();
}

// Each match has one button: Choose puts it in the basket, Chosen takes it back out. Once the
// basket holds as many as the room still allows, the rest can't be chosen.
function drawResults(): void {
  const results = document.getElementById('g-results');
  if (!results || !found.length) return;
  const full = basket.length >= leftNow();
  patch(results, ...found.map((song) => {
    const picked = chosen(song);
    return songItem(song, `found-${song.song_id}`, h('button', {
      type: 'button', className: `${picked ? 'g-quiet' : 'g-primary'} g-small-button`, 'aria-pressed': String(picked),
      'aria-label': `${picked ? 'Chosen, press to take out' : 'Choose'} ${songLine(song)}`,
      disabled: !picked && full,
      onclick: () => choose(song),
    }, picked ? 'Chosen' : 'Choose'));
  }));
}

function drawBasket(): void {
  const target = document.getElementById('g-basket');
  if (!target || !view) return;
  const left = leftNow();
  const room = left - basket.length;
  const words = left <= 0
    ? (view.limit_text || "You can't ask for more songs right now.")
    : room > 0 ? `You can add ${room} more.` : "That's as many as you can ask for right now.";
  patch(target,
    basket.length ? h('ul', { className: 'g-list', 'data-key': 'chosen' }, ...basket.map((song) => songItem(song, `chosen-${song.song_id}`,
      h('button', { type: 'button', className: 'g-quiet', 'aria-label': `Take out ${songLine(song)}`, onclick: () => choose(song) }, 'Take out')))) : null,
    h('p', { className: left <= 0 ? 'g-banner' : 'g-muted', 'data-key': 'left', role: left <= 0 ? 'status' : undefined },
      basket.length ? `${songsWord(basket.length)} chosen. ` : '', words),
    basket.length ? h('button', { type: 'button', className: 'g-primary', 'data-key': 'send', disabled: sending || left <= 0, onclick: () => void sendBasket() },
      sending ? 'Sending...' : basket.length === 1 ? 'Send request' : 'Send requests') : null);
}

async function sendBasket(): Promise<void> {
  if (sending || !basket.length) return;
  const songs = basket;
  const ticket = ++reads;
  sending = true;
  drawBasket();
  try {
    const answer = await call<{ results: Sent[]; room: View }>(`${base()}/requests/batch`, { method: 'POST', body: JSON.stringify({ song_ids: songs.map((song) => song.song_id) }) });
    const title = (id: number) => songs.find((song) => song.song_id === id)?.title ?? 'A song';
    const added = answer.results.filter((one) => one.added);
    const refused = answer.results.filter((one) => !one.added);
    const votes = added.filter((one) => one.became_vote).length;
    // what was sent leaves the basket; what was refused stays, so it can go again when there's room
    basket = songs.filter((song) => refused.some((one) => one.song_id === song.song_id));
    sending = false;
    if (newer(ticket)) view = answer.room;
    draw();
    say([
      added.length ? `Sent ${songsWord(added.length)}.` : '',
      votes ? `${songsWord(votes)} had been asked for already, so ${votes === 1 ? 'it counts' : 'they count'} as your vote.` : '',
      ...refused.map((one) => `Not added: ${title(one.song_id)}. ${one.message ?? ''}`.trim()),
    ].filter(Boolean).join(' '));
  } catch (error) {
    sending = false;
    drawBasket();
    say((error as Error).message);
    if ((error as ApiError).status === 401) void refresh();
  }
}

async function search(query: string, results: HTMLElement): Promise<void> {
  const seq = ++searchSeq;
  if (query.trim().length < 2) { found = []; replace(results); return; }
  try {
    const answer = await call<{ songs: Song[] }>(`${base()}/search?q=${encodeURIComponent(query.trim())}`);
    if (seq !== searchSeq) return;
    found = answer.songs;
    if (!found.length) { replace(results, h('li', { className: 'g-muted' }, 'No songs match that.')); return; }
    replace(results);
    drawResults();
  } catch (error) {
    if (seq === searchSeq) { found = []; replace(results, h('li', { className: 'g-error' }, (error as Error).message)); }
  }
}

async function nicknames(): Promise<void> {
  try {
    const { nicknames: choices } = await call<{ nicknames: string[] }>(`${base()}/nicknames`);
    const close = () => { document.getElementById('g-shell')?.remove(); draw(); };
    const confirm = confirming();
    if (confirm) picking = true;
    const pick = (name: string) => (confirm ? void saveNickname(name) : void act(`${base()}/nickname`, 'PUT', { nickname: name }, `You're ${name} now.`).then(schedule));
    screen('Pick a nickname', 'The host sees it. Other guests see it only if the host shows names.',
      h('div', { className: 'g-choices' }, ...choices.map((name) => h('button', { type: 'button', className: 'g-choice', onclick: () => pick(name) }, name))),
      h('button', { type: 'button', className: 'g-quiet', onclick: () => { picking = false; close(); schedule(); } }, 'Keep my nickname'));
    (root.querySelector('.g-choice') as HTMLElement | null)?.focus();
  } catch (error) {
    say((error as Error).message);
  }
}

// ADR-0422: the name line says which nickname the server has, and whether a change is on its way.
function nameLine(v: View): HTMLElement {
  const change = h('button', { type: 'button', className: 'g-link', onclick: () => void nicknames(), disabled: nameSave?.state === 'saving' }, 'Change nickname');
  if (nameSave?.state === 'saving') {
    return h('p', { className: 'g-muted', 'aria-busy': 'true', 'data-nickname': 'saving' }, `You're ${v.nickname}. Saving ${nameSave.name}... `, change);
  }
  if (nameSave?.state === 'saved' && nameSave.name === v.nickname) {
    return h('p', { className: 'g-muted', 'data-nickname': 'saved' }, `You're ${v.nickname}. Saved. `, change);
  }
  return h('p', { className: 'g-muted', 'data-nickname': nameSave?.state === 'failed' ? 'failed' : 'confirmed' }, `You're ${v.nickname}. `, change);
}

async function saveNickname(name: string): Promise<void> {
  if (!name || savingName) return;
  picking = false;
  nameSave = { state: 'saving', name };
  draw();
  schedule();
  const ticket = ++reads;
  savingName = true;
  nameEpoch += 1;
  try {
    const answer = await call<View>(`${base()}/nickname`, { method: 'PUT', body: JSON.stringify({ nickname: name }) });
    savingName = false;
    nameEpoch += 1;
    confirmedName = { name: answer.nickname, epoch: nameEpoch };
    // the save's own answer is the confirmed name, even if a newer read is already on screen
    if (newer(ticket)) view = answer;
    else if (view) view = { ...view, nickname: answer.nickname };
    nameSave = answer.nickname === name ? { state: 'saved', name } : { state: 'failed', name, error: 'Pick another one.' };
    draw();
    say(nameSave.state === 'saved' ? `You're ${name} now.` : `${name} wasn't saved.`);
  } catch (error) {
    savingName = false;
    nameEpoch += 1;
    nameSave = { state: 'failed', name, error: (error as Error).message };
    draw();
    if ((error as ApiError).status === 401) void refresh();
  }
}

async function leave(): Promise<void> {
  try {
    await call(`${base()}/leave`, { method: 'POST' });
  } catch { /* leaving locally is enough if the server can't be reached */ }
  store(roomKey, null);
  roomId = null;
  view = null;
  basket = [];
  found = [];
  screen('You left the room', 'The host still sees the songs you asked for.', h('button', { type: 'button', className: 'g-primary', onclick: () => joinScreen() }, 'Join again'));
}

// A venue's table card (ADR-0451) links to /r/{code}?at=venue: its own small page, loaded only then.
if (new URLSearchParams(location.search).get('at') === 'venue') {
  void import('./venue').then((venue) => venue.startVenue(root, code));
} else {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && roomId) void refresh(); });
  window.addEventListener('online', () => { if (roomId) void refresh(); });
  void refresh();
}
