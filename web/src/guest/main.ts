// The guest page at /r/{code}: join a room, see what's playing, search and request songs, vote,
// follow your requests, and leave. No app, no account, and no audio: the host's speaker plays.
//
// It's its own tiny bundle (no React) so it loads fast on old phones and weak signal; the build
// fails if its JavaScript passes 100 KB. The guest token lives in an HttpOnly cookie the page
// can't read; the page only remembers which room id its code opened, to find its way back.
//
// A guest taps a song to add it (the whole row is the button; a second tap takes it out). The row
// changes at once, and a bar fixed to the bottom of the screen counts what is chosen and holds
// Send. Sending shows progress, then "Sent", and the songs appear under "Your requests" with a
// status that follows the host. The page says how many more can be added, and when the room's
// limit is reached it says which limit and when it frees up, in the server's own words
// (`limit_text`). The server decides what is added: each song of a batch comes back added or
// with its reason, which stays on that song's row.
//
// Each read of the room also tells the host this guest is here, so the page reads it every 5 s
// while it's on screen. If the signal or the server drops, it says "Reconnecting..." and keeps
// trying (backing off to 15 s, and at once when the phone comes back online), with the same
// cookie, so the guest is back in the room by themselves. There's no leave-on-close beacon: a
// reload or a phone switching apps fires the same events, and leaving would put them out.

import { ApiError, call, h, patch, replace, Song, songLine, store } from '../rooms/dom';
import { art, bars, chip, empty, icon, IconName, outlineRow, songText, Tone } from './parts';
import * as social from './social/social';
import './guest.css';

type Item = { request_id: string; song: Song | null; status: string; votes: number; nickname: string | null; voted: boolean; mine: boolean };
type Mine = { request_id: string; song: Song | null; status: string; text: string; votes: number; minutes_until?: number | null };
type View = {
  room_name: string; room_status: string; guest_status: string; nickname: string;
  votes_on: boolean; requests_open: boolean; music_paused: boolean;
  now_playing: Song | null; up_next: Song[]; coming_up: Item[]; waiting: Item[]; my_requests: Mine[];
  nickname_confirm?: boolean;
  /** How many more songs this guest can ask for now; at 0, `limit_text` says why and until when. */
  requests_left?: number; limit_text?: string;
  /** ADR-0475: a browser-first room offers only the songs of the device making the sound. Absent
   * (an older server) is ready. */
  music?: 'ready' | 'choosing' | 'reconnecting' | 'none';
  /** ADR-0488: a paired big screen is showing now, and which of the room's shared features are
   * on. Absent (an older server) is no screen and none of them. */
  screen?: boolean; social?: social.Features;
};
/** What the guest is told while the room has no device to play from; never a device's name. */
const MUSIC_WORDS: Record<string, { title: string; more: string }> = {
  choosing: { title: 'The host is choosing where the music plays.', more: 'You can ask for songs in a moment.' },
  reconnecting: { title: 'The music is paused while the host’s device reconnects.', more: 'Your requests are kept.' },
  none: { title: 'The host hasn’t connected any music yet.', more: 'You can ask for songs once they do.' },
};
let lastMusic = 'ready';
type Sent = { song_id: number; added: boolean; became_vote?: boolean; already_queued?: boolean; code?: string; message?: string; retry_after_s?: number | null };

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
let noticeTimer = 0;
let searchSeq = 0;
// What the last search was for, whether an answer is on its way, and what went wrong with it:
// with `found` these decide what the results list shows (rows, their outline, or a plain reason).
let foundFor = '';
let searching = false;
let searchError = '';
// Taps being answered, by what they are ("withdraw:r1", "nicknames", "leave"): the button that was
// tapped shows it is working and ignores a second tap; nothing else on the page waits.
const busy = new Set<string>();
// A vote shows at once, before the server answers: request id to the choice just made.
const myVotes = new Map<string, boolean>();
// Each of my requests' last status, and the ones that just changed (lit for a moment).
const seen = new Map<string, string>();
const lit = new Map<string, number>();
const LIT_MS = 4000;
const PENDING = ['sent', 'accepted'];
// Why a song was not added when it was last sent, by song id: said under the song until the guest
// takes it out or sends again. `until` is when it can be asked for again, if the server said;
// `never` is a song this room does not take. Either one stops the song being sent or chosen.
type Why = { message: string; until?: number; never?: boolean };
const whyNot = new Map<number, Why>();
let whyTimer = 0;
const waitingOn = (song: Song) => { const why = whyNot.get(song.song_id); return Boolean(why && (why.never || (why.until !== undefined && why.until > Date.now()))); };
const whyWords = (song: Song) => { const why = whyNot.get(song.song_id); return !why ? '' : why.until !== undefined && why.until <= Date.now() ? 'You can ask for it now.' : why.message; };
/** Draw again the moment the next wait is over, so the song says it can be asked for and Send comes back. */
function watchWaits(): void {
  window.clearTimeout(whyTimer);
  const next = Math.min(...[...whyNot.values()].map((why) => why.until ?? Infinity).filter((until) => until > Date.now()));
  if (Number.isFinite(next)) whyTimer = window.setTimeout(() => { drawResults(); drawBar(); watchWaits(); }, Math.min(next - Date.now() + 250, 2 ** 30));
}
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

/** Props for a button whose tap is being answered: it stays focusable, says it is busy, and its handler ignores taps. */
const working = (on: boolean): Record<string, string> => (on ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {});

/** The parts that float over every screen, made when first needed: the notice at the bottom and
 * the connection banner at the top. They live beside the page, so no screen change removes them. */
function overlays(): void {
  if (document.getElementById('g-dock')) return;
  document.body.append(
    h('div', { className: 'g-net', id: 'g-net', role: 'status' }, h('i', { className: 'g-spin', 'aria-hidden': 'true' }), icon('check'), h('span', { id: 'g-net-text' })),
    h('div', { className: 'g-dock', id: 'g-dock' }, h('div', { className: 'g-toast', onclick: () => say('') }, h('p', { id: 'g-notice', className: 'g-notice', role: 'status' }))));
}

/** Say what just happened in the notice that floats over the bottom of the page (a live region),
 * so a line arriving never moves what is under a thumb. It clears itself after long enough to
 * read it. */
function say(text: string): void {
  notice = text;
  window.clearTimeout(noticeTimer);
  overlays();
  const live = document.getElementById('g-notice') as HTMLElement;
  // the words stay while the notice slides away, so it never empties in view
  if (text) live.textContent = text;
  const dock = document.getElementById('g-dock');
  if (text) dock?.setAttribute('data-open', ''); else dock?.removeAttribute('data-open');
  if (text) noticeTimer = window.setTimeout(() => say(''), Math.min(15_000, 4000 + text.length * 60));
}

/** The connection banner at the top of the screen: "Reconnecting..." while the room can't be
 * reached, "Back in the room" for a moment when it can again. */
let netTimer = 0;
function connection(state: 'down' | 'back' | 'ok'): void {
  overlays();
  const banner = document.getElementById('g-net') as HTMLElement;
  if (state === 'back' && banner.getAttribute('data-state') !== 'down') return;
  window.clearTimeout(netTimer);
  if (state === 'ok') { banner.removeAttribute('data-state'); return; }
  banner.setAttribute('data-state', state);
  (document.getElementById('g-net-text') as HTMLElement).textContent = state === 'back' ? 'Back in the room' : navigator.onLine === false ? "You're offline. Reconnecting..." : RECONNECTING;
  if (state === 'back') netTimer = window.setTimeout(() => connection('ok'), 2500);
}

/** A whole-screen card: the join, nickname, left and closed screens. */
function screen(title: string, text: string, ...extra: (Node | null)[]): void {
  window.clearTimeout(timer);
  const same = root.querySelector('.g-card > h1')?.textContent === title;
  const heading = h('h1', { tabindex: -1 }, title);
  replace(root, h('section', { className: 'g-card' }, brand(), heading, text ? h('p', { className: 'g-lede' }, text) : null, ...extra));
  // a new screen is said by moving to its heading; one drawn again (a retry) leaves focus alone
  if (!same) heading.focus({ preventScroll: true });
}

/** The product's mark and name, small, over a screen's title. */
function brand(): HTMLElement {
  return h('p', { className: 'g-brandline' }, h('i', { className: 'g-mark', 'aria-hidden': 'true' }), 'SelectaDJ');
}

/** A screen that is a full stop (closed, removed, off): a drawn mark over the title. */
function stop(mark: IconName, title: string, text: string, ...extra: (Node | null)[]): void {
  screen(title, text, ...extra);
  root.querySelector('.g-card')?.prepend(h('span', { className: 'g-empty-mark g-stop-mark', 'aria-hidden': 'true' }, icon(mark)));
}

function joinScreen(error = ''): void {
  if (!code) {
    stop('search', 'No room code', 'Scan the QR code at the party, or open the link you were given.');
    return;
  }
  const button = h('button', { className: 'g-primary g-big', type: 'button', onclick: () => void join(button as HTMLButtonElement) }, 'Join the room');
  screen(
    'Request a song',
    "See what's playing and ask the host for songs. Nothing plays on your phone.",
    h('p', { className: 'g-codebox' }, h('span', { className: 'g-eyebrow' }, 'Room code'), h('span', { className: 'g-code' }, shown(code))),
    error ? h('p', { className: 'g-error', role: 'alert' }, error) : null,
    button,
    h('p', { className: 'g-small g-center' }, "You'll get a nickname you can change. No account needed."),
    h('details', { className: 'g-keeps' }, h('summary', {}, 'What SelectaDJ keeps'),
      h('p', { className: 'g-small' }, 'A random guest id, a scrambled form of your network address, your nickname, your requests, and your votes and reactions. They are deleted 30 days after the room closes. Songs you keep stay on this phone only. No tracking.')),
    // ADR-0488: songs kept in earlier rooms are on this phone, so they show before joining
    social.earlier(),
  );
  (button as HTMLButtonElement).focus();
}

async function join(button: HTMLButtonElement): Promise<void> {
  if (button.getAttribute('aria-busy')) return;
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
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
    failures = 0;
    connection('back');
    if ((confirming() || fresh.nickname_confirm) && (overlapped || epoch !== nameEpoch)) { schedule(); return; }
    if (!newer(ticket)) { schedule(); return; }
    view = fresh;
    draw();
    if (view.room_status !== 'ended') schedule();
  } catch (error) {
    if (roomId !== asked) return;
    const problem = error as ApiError;
    if (problem.code === 'flag_off') { stop('off', 'Rooms are off', problem.message); return; }
    if (problem.status === 401) { store(roomKey, null); roomId = null; joinScreen(); return; }
    if (problem.code === 'banned') { store(roomKey, null); stop('lock', "You can't join this room", 'The host has removed you from this room.'); return; }
    if (problem.status === 410) { closed(null); return; }
    failures += 1;
    if (view) { draw(); connection('down'); } else screen(RECONNECTING, `${problem.message} This page keeps trying.`, h('p', { className: 'g-waitline' }, h('i', { className: 'g-spin', 'aria-hidden': 'true' }), 'Trying again'));
    schedule();
  }
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { className: 'g-section', 'aria-label': title, 'data-key': title }, h('h2', {}, title), ...children);
}

/** A song in a list: its tile, its two lines, then whatever the list adds (a vote, a name). */
function songItem(song: Song | null, key: string | undefined, ...extra: (Node | string | null)[]): HTMLElement {
  return h('li', { className: 'g-item', 'data-key': key }, art(song), songText(song), ...extra);
}

/** The room is over: thanks, and what became of the songs this guest asked for. */
function closed(v: View | null): void {
  connection('ok');
  social.stop();
  stop('moon', 'This room has closed', 'Thanks for coming. The host has ended the party.',
    v?.my_requests.length ? myRequests(v) : null,
    // ADR-0488: the songs this guest kept are on their phone, so they outlive the room
    social.keptAfter(roomId ?? code, v?.room_name ?? ''));
}

function voteButton(item: Item): HTMLElement | null {
  if (!view?.votes_on || item.mine) return null;
  // a vote just tapped shows at once, with its count, while the server is asked
  const choice = myVotes.get(item.request_id);
  const voted = choice ?? item.voted;
  const count = Math.max(0, item.votes + (voted === item.voted ? 0 : voted ? 1 : -1));
  const label = voted ? `Remove your vote for ${songLine(item.song)}` : `Vote for ${songLine(item.song)}`;
  return h('button', {
    type: 'button', className: 'g-vote', 'aria-pressed': String(voted), 'aria-label': label, 'aria-busy': choice === undefined ? undefined : 'true',
    onclick: () => { buzz(8); void vote(item); },
  }, String(count));
}

async function vote(item: Item): Promise<void> {
  if (myVotes.has(item.request_id)) return;
  myVotes.set(item.request_id, !item.voted);
  draw();
  await act(`${base()}/requests/${encodeURIComponent(item.request_id)}/vote`, item.voted ? 'DELETE' : 'POST');
  myVotes.delete(item.request_id);
  draw();
}

async function withdraw(requestId: string): Promise<void> {
  const key = `withdraw:${requestId}`;
  if (busy.has(key)) return;
  busy.add(key);
  draw();
  await act(`${base()}/requests/${encodeURIComponent(requestId)}`, 'DELETE', undefined, 'Request withdrawn.');
  busy.delete(key);
  draw();
}

async function act(path: string, method: string, body?: unknown, success = ''): Promise<void> {
  const ticket = ++reads;
  const epoch = nameEpoch;
  try {
    const answer = await call<View | { room: View }>(path, { method, body: body ? JSON.stringify(body) : undefined });
    const before = notice;
    if (newer(ticket)) {
      view = adopt('room' in answer ? answer.room : (answer as View), epoch);
      draw();
    }
    // a status change this answer brought has just been said: leave it up
    if (success || notice === before) say(success);
  } catch (error) {
    say((error as Error).message);
    if ((error as ApiError).status === 401) void refresh();
  }
}

function shell(): Record<string, HTMLElement> {
  let page = document.getElementById('g-shell');
  let opened = false;
  if (!page) {
    const leaving = h('button', { type: 'button', className: 'g-quiet', onclick: () => void leave(leaving) }, 'Leave room');
    // what's playing, then the search, then my requests right under it, where the guest just
    // asked; the bar of chosen songs is fixed to the bottom of the screen
    page = h('div', { id: 'g-shell' },
      h('header', { className: 'g-head', id: 'g-head' }),
      h('div', { id: 'g-banners' }),
      h('div', { id: 'g-now' }),
      searchPanel(),
      h('div', { id: 'g-mine' }),
      h('div', { id: 'g-lists' }),
      h('div', { id: 'g-kept' }),
      h('p', { className: 'g-leave' }, leaving),
      h('div', { className: 'g-bar', id: 'g-bar' }));
    replace(root, page);
    overlays();
    opened = true;
  }
  const part = (id: string) => document.getElementById(id) as HTMLElement;
  // a screen reader hears the room's name when the room first opens
  if (opened) window.setTimeout(() => { if (!root.contains(document.activeElement)) document.getElementById('g-name')?.focus({ preventScroll: true }); }, 0);
  return { head: part('g-head'), banners: part('g-banners'), now: part('g-now'), search: part('g-search'), lists: part('g-lists'), mine: part('g-mine'), kept: part('g-kept') };
}

// Only the parts that change are redrawn, and those are patched in place (keyed by request), so a
// poll never takes focus from a Vote or Withdraw button, nor typing from the search.
function draw(): void {
  if (!view) return;
  // ADR-0422: a poll landing while the guest is picking a nickname mustn't close the picker
  if (picking && confirming()) return;
  const v = view;
  if (v.room_status === 'ended') { closed(v); return; }
  const parts = shell();
  const changed = statusChanges(v);
  patch(parts.head,
    h('div', { className: 'g-topline' }, brand(), nameLine(v)),
    h('h1', { id: 'g-name', tabindex: -1 }, v.room_name),
    v.nickname_confirm && nameSave?.state === 'failed' ? h('p', { className: 'g-error', role: 'alert' }, `${nameSave.name} wasn't saved. ${nameSave.error ?? ''}`.trim(), ' ', h('button', { type: 'button', className: 'g-link', onclick: () => void saveNickname(nameSave?.name ?? '') }, 'Try again')) : null);
  const active = v.guest_status === 'active';
  // ADR-0475: no device to play from yet (or it is reconnecting): said, and search waits with the
  // guest's text kept; when the music is back, a search they had typed runs again by itself
  const music = v.music ?? 'ready';
  const held = active && v.requests_open && music !== 'ready' ? MUSIC_WORDS[music] : null;
  patch(parts.banners,
    v.guest_status === 'pending' ? h('div', { className: 'g-section g-waiting', role: 'status' }, h('i', { className: 'g-spin', 'aria-hidden': 'true' }), h('p', {}, h('strong', {}, 'Waiting for the host to let you in'), h('span', { className: 'g-muted' }, 'This page opens by itself when they do.'))) : null,
    held ? h('div', { className: 'g-section g-waiting', role: 'status', 'data-music': music, 'data-key': `music-${music}` }, h('p', {}, h('strong', {}, held.title), h('span', { className: 'g-muted' }, held.more))) : null);
  patch(parts.now, active ? nowPlaying(v) : null);
  parts.search.hidden = !(active && v.requests_open) || music === 'none';
  const box = document.getElementById('g-q') as HTMLInputElement | null;
  if (box) box.disabled = music !== 'ready';
  if (lastMusic !== 'ready' && music === 'ready' && box && box.value.trim().length >= 2) box.dispatchEvent(new Event('input'));
  lastMusic = music;
  if (!parts.search.hidden) drawResults();
  drawBar();
  patch(parts.lists,
    active && !v.requests_open ? h('section', { className: 'g-section', 'data-key': 'Requests', 'aria-label': 'Requests' }, empty('lock', 'Requests are off in this room', 'The host is choosing the music for now.')) : null,
    active && v.coming_up.length ? section('Coming up from guests', h('ol', { className: 'g-list' }, ...v.coming_up.map((item) => songItem(item.song, item.request_id, h('span', { className: 'g-tail' }, item.nickname ? h('span', { className: 'g-by' }, item.nickname) : null, voteButton(item)))))) : null,
    active && v.waiting.length ? section('Waiting for the host', h('ul', { className: 'g-list' }, ...v.waiting.map((item) => songItem(item.song, item.request_id, voteButton(item))))) : null);
  // nothing shows here until the guest has asked for something
  patch(parts.mine, active && v.my_requests.length ? myRequests(v) : null);
  // ADR-0488: the songs this guest kept, and the room's pulse while something in it moves
  patch(parts.kept, active ? social.kept(v) : null);
  social.sync(v, active);
  if (changed) say(changed);
}

/** What's playing, with what comes after it in the same card. It always has its tile and two
 * lines, so the page below never moves when a song starts. */
function nowPlaying(v: View): HTMLElement {
  const song = v.now_playing;
  const playing = Boolean(song) && !v.music_paused;
  return h('section', { className: 'g-section g-hero', 'aria-label': 'Now playing', 'data-key': 'Now playing', 'data-on': playing },
    h('div', { className: 'g-hero-now' },
      art(song, 'lg'),
      h('div', { className: 'g-hero-text' },
        h('h2', {}, bars(playing), song && v.music_paused ? 'Paused' : 'Now playing'),
        h('p', { className: song ? 'g-now' : 'g-now g-muted' }, song ? song.title : 'Nothing playing yet'),
        h('p', { className: 'g-now-by' }, song ? song.artist : 'Ask for a song and the host adds it to the mix.'))),
    social.hero(v),
    v.up_next.length ? h('div', { className: 'g-next', 'data-key': 'next' },
      h('h2', {}, 'Up next'),
      h('ol', { className: 'g-list' }, ...v.up_next.slice(0, 3).map((next, index) => songItem(next, `next-${index}-${next.song_id}`)))) : null);
}

/** Note which of my requests changed status since the last look: they are lit for a moment, and
 * the newest change is returned in words for the notice. */
let looked = false;
function statusChanges(v: View): string {
  const now = Date.now();
  let said = '';
  for (const item of v.my_requests) {
    const before = seen.get(item.request_id);
    if (before && before !== item.status) {
      lit.set(item.request_id, now + LIT_MS);
      // their own withdrawal is said by the button they tapped
      if (item.status !== 'withdrawn') said = `${item.song?.title ?? 'Your request'}: ${item.text}.`;
    }
    // a request first seen here was just sent: it arrives lit, and Sent says the rest
    if (!before && looked && PENDING.includes(item.status)) lit.set(item.request_id, now + LIT_MS);
    seen.set(item.request_id, item.status);
  }
  looked = true;
  for (const [id, until] of lit) if (until <= now) lit.delete(id);
  return said;
}

/** A request's status as a short chip, and anything more the host's words add under it. */
function statusOf(item: Mine, v: View): { kind: Tone; label: string; detail: string } {
  const id = item.song?.song_id;
  const going = id !== undefined && (item.status === 'accepted' || item.status === 'played');
  if (going && v.now_playing?.song_id === id) return { kind: 'live', label: 'Playing now', detail: '' };
  if (going && v.up_next.some((song) => song.song_id === id)) return { kind: 'next', label: 'Up next', detail: '' };
  const rest = (text: string, label: string) => { const more = text.replace(new RegExp(`^${label}[.,]?\\s*`), ''); return more ? more[0].toUpperCase() + more.slice(1) : ''; };
  switch (item.status) {
    case 'sent': return { kind: 'wait', label: 'Waiting for the host', detail: '' };
    case 'accepted': return { kind: 'ok', label: 'Accepted', detail: rest(item.text, 'Accepted') };
    case 'played': return { kind: 'done', label: item.text || 'Played', detail: '' };
    case 'passed': case 'unfit': return { kind: 'no', label: 'Not this time', detail: item.text };
    case 'withdrawn': return { kind: 'gone', label: 'Withdrawn', detail: rest(item.text, 'Withdrawn') };
    default: return { kind: 'gone', label: item.text, detail: '' };
  }
}

function myRequests(v: View): HTMLElement {
  return h('section', { className: 'g-section', id: 'g-requests', 'aria-label': 'Your requests', 'data-key': 'Your requests' },
    h('h2', {}, 'Your requests', h('span', { className: 'g-tally' }, String(v.my_requests.length))),
    h('ul', { className: 'g-list' }, ...v.my_requests.map((item) => {
      const leaving = busy.has(`withdraw:${item.request_id}`);
      const status = statusOf(item, v);
      return h('li', { className: lit.has(item.request_id) ? 'g-item g-request g-changed' : 'g-item g-request', 'data-key': item.request_id, 'data-status': item.status },
        art(item.song),
        songText(item.song,
          h('span', { className: 'g-status' }, chip(status.kind, status.label)),
          status.detail ? h('span', { className: 'g-detail' }, status.detail) : null),
        PENDING.includes(item.status) && v.room_status !== 'ended'
          ? h('button', { type: 'button', className: 'g-quiet g-small-button', ...working(leaving), 'aria-label': `Withdraw ${songLine(item.song)}`, onclick: () => void withdraw(item.request_id) }, leaving ? 'Withdrawing...' : 'Withdraw')
          : null);
    })));
}

function searchPanel(): HTMLElement {
  const results = h('ul', { className: 'g-list', id: 'g-results', 'aria-label': 'Songs found' });
  const input = h('input', {
    id: 'g-q', type: 'search', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    enterkeyhint: 'search', placeholder: 'Search by title or artist', maxlength: 100, 'aria-describedby': 'g-hint',
  }) as HTMLInputElement;
  const clear = h('button', { type: 'button', className: 'g-clear', id: 'g-clear', 'aria-label': 'Clear the search', hidden: true, onclick: () => { input.value = ''; ask(0); input.focus(); } }, icon('x'));
  // the box stays at the top of the screen while the results scroll under it (guest.css)
  const panel = h('section', { className: 'g-section', id: 'g-search', 'aria-label': 'Request a song' },
    h('h2', {}, h('label', { for: 'g-q' }, 'Request a song')),
    h('div', { className: 'g-search-box' }, icon('search'), input, clear),
    h('p', { className: 'g-hint', id: 'g-hint' }),
    // said to a screen reader as results come and go; the notice is kept for what the guest did
    h('p', { className: 'g-sr', id: 'g-found', 'aria-live': 'polite' }),
    results);
  let wait = 0;
  // typing waits a moment before asking; Enter asks at once. Either way the list answers the
  // keystroke straight away, with the outline of the rows to come.
  const ask = (delay: number) => {
    window.clearTimeout(wait);
    const query = input.value.trim();
    clear.hidden = !input.value;
    searchError = '';
    if (query.length < 2) { searchSeq += 1; searching = false; found = []; foundFor = ''; drawResults(); return; }
    searching = true;
    drawResults();
    wait = window.setTimeout(() => void search(query), delay);
  };
  input.addEventListener('input', () => ask(200));
  input.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); ask(0); input.blur(); } });
  // on a phone the keyboard takes half the screen: bring the search to the top, so the results
  // sit between the box and the keyboard
  input.addEventListener('focus', () => {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => panel.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' }), 250);
  });
  return panel;
}

/** Whether this song is already one of my requests that's waiting or coming up. */
const asked = (song: Song) => Boolean(view?.my_requests.some((item) => item.song?.song_id === song.song_id && PENDING.includes(item.status)));

function chosen(song: Song): boolean {
  return basket.some((one) => one.song_id === song.song_id);
}

function choose(song: Song): void {
  if (!chosen(song) && waitingOn(song)) return;
  // taking a song out puts its reason away, unless it is a wait that still holds (the search row says it)
  if (chosen(song) && !waitingOn(song)) whyNot.delete(song.song_id);
  basket = chosen(song) ? basket.filter((one) => one.song_id !== song.song_id) : [...basket, song];
  sent = null;
  drawResults();
  drawBar();
}

// A tap that can't add the song still answers: the row shakes its head and says why under itself.
let told: { id: number; text: string; turn: number } | null = null;
let toldTimer = 0;
function tell(song: Song, text: string): void {
  told = { id: song.song_id, text, turn: (told?.turn ?? 0) + 1 };
  window.clearTimeout(toldTimer);
  toldTimer = window.setTimeout(() => { told = null; drawResults(); }, 5000);
  drawResults();
}

/** A short buzz that answers a press, on a phone that can (in practice Android). Called only
 * inside the press itself, so browsers allow it; anywhere it can't, it does nothing. */
function buzz(ms: number): void {
  try { if (window.matchMedia?.('(pointer: coarse)').matches) navigator.vibrate?.(ms); } catch { /* a browser that throws cannot buzz */ }
}

/** One tap on a song's row: add it, or take it back out, or say why it can't be added now. */
function tap(song: Song): void {
  if (sending) return;
  const picked = chosen(song);
  if (!picked && asked(song)) { tell(song, "It's already in your requests."); return; }
  if (!picked && waitingOn(song)) { tell(song, whyWords(song)); return; }
  if (!picked && basket.length >= leftNow()) {
    tell(song, leftNow() <= 0 ? (view?.limit_text || "You can't ask for more songs right now.") : `You can ask for ${songsWord(leftNow())} right now. Take one out to swap it for this.`);
    return;
  }
  told = null;
  buzz(8);
  choose(song);
}

// Each match is one button, the whole row: a tap adds the song (the row tints, its tile fills with
// a check, "Add" becomes "Added"), a second tap takes it out. A row that can't be added says why.
function resultRow(song: Song): HTMLElement {
  const picked = chosen(song);
  const mine = !picked && asked(song);
  const held = !picked && !mine && waitingOn(song);
  const full = !picked && !mine && !held && basket.length >= leftNow();
  const state = picked ? 'picked' : mine ? 'asked' : held ? 'held' : full ? 'full' : 'idle';
  const why = told?.id === song.song_id ? told.text : held || (picked && whyNot.has(song.song_id)) ? whyWords(song) : '';
  const words = picked ? 'Added' : mine ? 'Requested' : held ? 'Not now' : 'Add';
  return h('li', { className: 'g-row', 'data-key': `found-${song.song_id}`, 'data-state': state, 'data-told': told?.id === song.song_id ? String(told.turn % 2) : undefined },
    h('button', {
      type: 'button', className: 'g-pick', 'aria-pressed': mine || held ? undefined : String(picked),
      'aria-label': picked ? `Added: ${songLine(song)}. Press to remove` : mine ? `Requested: ${songLine(song)}` : `Add ${songLine(song)}`,
      'aria-disabled': mine || held || full ? 'true' : undefined, 'aria-describedby': why ? `g-why-${song.song_id}` : undefined,
      onclick: () => tap(song),
    },
    art(song, '', h('span', { className: 'g-art-check' }, icon('check'))),
    songText(song),
    h('span', { className: 'g-add' }, h('span', { className: 'g-add-pill' }, icon('plus'), icon('check'), words), picked ? h('span', { className: 'g-add-hint' }, 'Tap to remove') : null)),
    why ? h('p', { className: waitingOn(song) || told?.id === song.song_id ? 'g-why' : 'g-why g-why-ready', id: `g-why-${song.song_id}`, role: 'status' }, why) : null);
}

function drawResults(): void {
  const results = document.getElementById('g-results');
  if (!results || !view) return;
  if (searching) results.setAttribute('aria-busy', 'true'); else results.removeAttribute('aria-busy');
  let rows: HTMLElement[] = [];
  let said = '';
  if (searchError) {
    // what went wrong, and one way on
    const again = () => { searchError = ''; searching = true; drawResults(); void search((document.getElementById('g-q') as HTMLInputElement).value.trim()); };
    rows = [h('li', { className: 'g-plain', 'data-key': 'error' }, empty('off', "The search didn't go through", searchError), h('button', { type: 'button', className: 'g-quiet g-small-button', onclick: again }, 'Try again'))];
    said = `The search didn't go through. ${searchError}`;
  } else if (found.length) {
    rows = found.map(resultRow);
    said = searching ? '' : `${songsWord(found.length)} found.`;
  } else if (searching) {
    rows = [0, 1, 2, 3].map(outlineRow);
    said = 'Searching...';
  } else if (foundFor) {
    rows = [h('li', { className: 'g-plain', 'data-key': 'empty' }, empty('search', `No songs match "${foundFor}"`, "Check the spelling, or try the artist's name."))];
    said = `No songs match "${foundFor}".`;
  }
  patch(results, ...rows);
  // under the box: how many songs can still be asked for, or the room's limit in its own words
  const hint = document.getElementById('g-hint');
  if (hint) {
    const left = leftNow();
    const limited = left <= 0;
    hint.className = limited ? 'g-hint g-limit' : 'g-hint';
    if (limited) hint.setAttribute('role', 'status'); else hint.removeAttribute('role');
    patch(hint, limited ? icon('clock') : null, h('span', {}, limited ? (view.limit_text || "You can't ask for more songs right now.") : rows.length ? (searching ? 'Searching...' : found.length ? `${songsWord(found.length)}. Tap one to add it.` : '') : view.requests_left === undefined ? "Find a song in the host's music and tap it to add it." : `Find a song in the host's music and tap it. You can ask for ${songsWord(left)}.`));
  }
  const live = document.getElementById('g-found');
  if (live && live.textContent !== said) live.textContent = said;
}

// The bar fixed to the bottom of the screen, above the on-screen keyboard: how many songs are
// chosen (press it to see them and take any out), and Send. After sending it says "Sent" for a
// moment. `sent` is that message; `listOpen` is whether the chosen songs are showing.
let sent: { title: string; text: string } | null = null;
let sentTimer = 0;
let listOpen = false;

function drawBar(): void {
  const bar = document.getElementById('g-bar');
  if (!bar || !view) return;
  const count = view.guest_status === 'active' && view.requests_open ? basket.length : 0;
  const left = leftNow();
  const room = left - count;
  const words = left <= 0
    ? (view.limit_text || "You can't ask for more songs right now.")
    : count && basket.every(waitingOn) ? "Can't be sent yet. Take it out to carry on"
      : room > 0 ? `You can add ${room} more` : "That's your limit for now";
  if (!count) listOpen = false;
  patch(bar,
    count && listOpen ? h('ul', { className: 'g-list g-chosen', id: 'g-chosen', 'data-key': 'chosen', 'aria-label': 'Chosen songs' }, ...basket.map((song) => h('li', { className: 'g-item', 'data-key': `chosen-${song.song_id}` },
      art(song),
      // why it was not added last time, kept here until it is taken out or sent again
      songText(song, whyNot.has(song.song_id) ? h('span', { className: waitingOn(song) ? 'g-why' : 'g-why g-why-ready', role: 'status' }, whyWords(song)) : null),
      h('button', { type: 'button', className: 'g-quiet g-small-button', 'aria-label': `Remove ${songLine(song)}`, onclick: () => choose(song) }, 'Remove')))) : null,
    count ? h('div', { className: 'g-bar-row', 'data-key': 'row' },
      h('button', { type: 'button', className: 'g-count', 'aria-expanded': String(listOpen), 'aria-controls': 'g-chosen', onclick: () => { listOpen = !listOpen; drawBar(); } },
        // a new number is a new node, so it pops each time the count changes
        h('span', { className: 'g-badge', 'data-key': `count-${count}` }, String(count)),
        h('span', { className: 'g-count-text' }, h('strong', {}, count === 1 ? 'song chosen' : 'songs chosen'), h('span', { className: left <= 0 ? 'g-count-sub g-error' : 'g-count-sub' }, words)),
        icon('up')),
      h('button', { type: 'button', className: 'g-primary g-send', id: 'g-send', 'aria-busy': sending ? 'true' : undefined, disabled: sending || left <= 0 || basket.every(waitingOn), onclick: () => { buzz(12); void sendBasket(); } },
        sending ? 'Sending...' : count === 1 ? 'Send request' : 'Send requests'))
    : sent ? h('div', { className: 'g-sent', 'data-key': 'sent', role: 'status' },
      h('span', { className: 'g-tick', 'aria-hidden': 'true' }, icon('check')),
      h('p', {}, h('strong', {}, sent.title), ' ', sent.text),
      h('button', { type: 'button', className: 'g-quiet g-small-button', onclick: () => { document.getElementById('g-requests')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); done(); } }, 'View')) : null);
  if (count || sent) bar.setAttribute('data-open', ''); else bar.removeAttribute('data-open');
  // the page ends above the bar and the notice floats above it, never under it
  document.documentElement.style.setProperty('--bar', `${count || sent ? bar.offsetHeight : 0}px`);
}

function done(): void {
  window.clearTimeout(sentTimer);
  sent = null;
  drawBar();
}

async function sendBasket(): Promise<void> {
  // a song still waiting out its time stays in the basket with its reason; the rest go
  const held = basket.filter(waitingOn);
  const songs = basket.filter((song) => !waitingOn(song));
  if (sending || !songs.length) return;
  const ticket = ++reads;
  sending = true;
  drawBar();
  try {
    const answer = await call<{ results: Sent[]; room: View }>(`${base()}/requests/batch`, { method: 'POST', body: JSON.stringify({ song_ids: songs.map((song) => song.song_id) }) });
    const added = answer.results.filter((one) => one.added);
    const refused = answer.results.filter((one) => !one.added);
    const votes = added.filter((one) => one.became_vote).length;
    // what was sent leaves the basket; what was refused stays, so it can go again when there's room
    basket = [...held, ...songs.filter((song) => refused.some((one) => one.song_id === song.song_id))];
    for (const song of songs) whyNot.delete(song.song_id);
    for (const one of refused) {
      // the device playing changed since the search: said plainly, and the results are read again
      const gone = one.code === 'not_requestable';
      whyNot.set(one.song_id, { message: gone ? 'That song isn’t available right now.' : one.message || "This one wasn't added. Try again.", until: one.retry_after_s ? Date.now() + one.retry_after_s * 1000 : undefined, never: gone });
    }
    watchWaits();
    sending = false;
    window.clearTimeout(sentTimer);
    sent = added.length ? {
      title: 'Sent.',
      text: votes === added.length ? (votes === 1 ? 'Someone asked for it already, so it counts as your vote.' : 'They were asked for already, so they count as your votes.')
        : `The host will add ${added.length === 1 ? 'it' : 'them'} to the mix.`,
    } : null;
    if (sent) sentTimer = window.setTimeout(done, 6000);
    // everything went: the search is put away, so "Your requests" is what the guest sees next
    if (added.length && !basket.length) {
      const input = document.getElementById('g-q') as HTMLInputElement | null;
      if (input) { input.value = ''; input.blur(); }
      const clear = document.getElementById('g-clear');
      if (clear) clear.hidden = true;
      searchSeq += 1; searching = false; found = []; foundFor = '';
    }
    if (basket.length) listOpen = true;
    if (newer(ticket)) view = answer.room;
    draw();
    if (added.length && !basket.length) document.getElementById('g-requests')?.scrollIntoView?.({ block: 'nearest' });
    if (refused.length) say(`${added.length ? `Sent ${songsWord(added.length)}. ` : ''}${refused.length === 1 ? "1 song wasn't added. The reason is under it." : `${songsWord(refused.length)} weren't added. The reason is under each one.`}`);
  } catch (error) {
    sending = false;
    drawBar();
    say(`Not sent. ${(error as Error).message}`);
    if ((error as ApiError).status === 401) void refresh();
  }
}

async function search(query: string): Promise<void> {
  const seq = ++searchSeq;
  try {
    const answer = await call<{ songs: Song[] }>(`${base()}/search?q=${encodeURIComponent(query)}`);
    if (seq !== searchSeq) return;
    found = answer.songs;
    foundFor = query;
  } catch (error) {
    if (seq !== searchSeq) return;
    found = [];
    searchError = (error as Error).message;
  }
  searching = false;
  drawResults();
}

async function nicknames(): Promise<void> {
  if (busy.has('nicknames')) return;
  busy.add('nicknames');
  draw();
  try {
    const { nicknames: choices } = await call<{ nicknames: string[] }>(`${base()}/nicknames`).finally(() => busy.delete('nicknames'));
    const close = () => { document.getElementById('g-shell')?.remove(); draw(); };
    const confirm = confirming();
    if (confirm) picking = true;
    const pick = (name: string) => (confirm ? void saveNickname(name) : void act(`${base()}/nickname`, 'PUT', { nickname: name }, `You're ${name} now.`).then(schedule));
    screen('Pick a nickname', 'The host sees it. Other guests see it only if the host shows names.',
      h('div', { className: 'g-choices' }, ...choices.map((name) => h('button', { type: 'button', className: 'g-choice', onclick: (event: Event) => {
        if (root.querySelector('.g-choice[aria-busy]')) return;
        (event.currentTarget as HTMLElement).setAttribute('aria-busy', 'true');
        pick(name);
      } }, name))),
      h('button', { type: 'button', className: 'g-quiet g-big', onclick: () => { picking = false; close(); schedule(); } }, `Keep ${view?.nickname ?? 'my nickname'}`));
    (root.querySelector('.g-choice') as HTMLElement | null)?.focus();
  } catch (error) {
    draw();
    say((error as Error).message);
  }
}

// The nickname is a button in the room's header: press it to pick another. ADR-0422: with
// rooms.nickname_confirm it also says whether a change is on its way or saved.
function nameLine(v: View): HTMLElement {
  const state = !v.nickname_confirm ? undefined : nameSave?.state === 'saving' ? 'saving' : nameSave?.state === 'saved' && nameSave.name === v.nickname ? 'saved' : nameSave?.state === 'failed' ? 'failed' : 'confirmed';
  const saving = state === 'saving';
  return h('button', {
    type: 'button', className: 'g-name', 'data-nickname': state, ...working(busy.has('nicknames') || saving), disabled: saving,
    onclick: () => void nicknames(),
  },
  // named by its own words plus hidden ones (WCAG 2.5.3): "You're Fox. Change nickname", or
  // "You're Fox. Saving Owl...", so the name always contains what is seen
  state === 'saved' ? icon('check') : icon('person'),
  h('span', { className: 'g-sr' }, saving ? `You're ${v.nickname}. ` : "You're "),
  h('span', { className: 'g-name-text' }, saving ? `Saving ${nameSave?.name}...` : v.nickname),
  saving ? null : h('span', { className: 'g-sr' }, '. '),
  saving ? null : h('span', { className: 'g-name-change' }, state === 'saved' ? 'Saved' : 'Change'),
  saving || state === 'saved' ? null : h('span', { className: 'g-sr' }, ' nickname'));
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

async function leave(button: HTMLElement): Promise<void> {
  if (busy.has('leave')) return;
  busy.add('leave');
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
  button.textContent = 'Leaving...';
  try {
    await call(`${base()}/leave`, { method: 'POST' });
  } catch { /* leaving locally is enough if the server can't be reached */ }
  busy.delete('leave');
  social.stop();
  store(roomKey, null);
  roomId = null;
  view = null;
  basket = [];
  found = [];
  sent = null;
  connection('ok');
  say('');
  screen('You left the room', 'The host still sees the songs you asked for.', h('button', { type: 'button', className: 'g-primary g-big', onclick: () => joinScreen() }, 'Join again'));
}

// The on-screen keyboard covers the bottom of the page without resizing it. Its height goes to the
// stylesheet as --kb, so the Send bar and the notice sit above the keys, not under them.
const viewport = window.visualViewport;
if (viewport) {
  const fit = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))}px`);
  viewport.addEventListener('resize', fit);
  viewport.addEventListener('scroll', fit);
}

// A venue's table card (ADR-0451) links to /r/{code}?at=venue: its own small page, loaded only then.
if (new URLSearchParams(location.search).get('at') === 'venue') {
  void import('./venue').then((venue) => venue.startVenue(root, code));
} else {
  // ADR-0488: kept songs are filed under the room's id, which stays the same through a new code
  social.init({ base, shelf: () => roomId ?? code, redraw: draw, say, buzz });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && roomId) void refresh(); });
  window.addEventListener('online', () => { if (roomId) void refresh(); });
  // the phone says it lost its signal: say so at once, without waiting for the next read to fail
  window.addEventListener('offline', () => { if (roomId && view) { failures = Math.max(1, failures); connection('down'); } });
  void refresh();
}
