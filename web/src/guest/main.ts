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
  if (Number.isFinite(next)) whyTimer = window.setTimeout(() => { drawResults(); drawBasket(); watchWaits(); }, Math.min(next - Date.now() + 250, 2 ** 30));
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

/** A check mark that draws itself in (guest.css). Drawn, not typed, so no font can change it. */
function check(): Element {
  const space = 'http://www.w3.org/2000/svg';
  const mark = document.createElementNS(space, 'svg');
  mark.setAttribute('class', 'g-check');
  mark.setAttribute('viewBox', '0 0 16 16');
  mark.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(space, 'path');
  line.setAttribute('d', 'M3 8.5l3.2 3.2L13 5');
  line.setAttribute('pathLength', '1');
  mark.append(line);
  return mark;
}

/** Say what just happened in the notice that floats over the bottom of the page (a live region),
 * so a line arriving never moves what is under a thumb. It clears itself after long enough to
 * read it, except while the page is reconnecting. */
function say(text: string): void {
  notice = text;
  window.clearTimeout(noticeTimer);
  const live = document.getElementById('g-notice');
  if (!live) return;
  live.textContent = text;
  const dock = document.getElementById('g-dock');
  if (text) dock?.setAttribute('data-open', ''); else dock?.removeAttribute('data-open');
  if (text && text !== RECONNECTING) noticeTimer = window.setTimeout(() => say(''), Math.min(15_000, 4000 + text.length * 60));
}

function screen(title: string, text: string, ...extra: (Node | null)[]): void {
  window.clearTimeout(timer);
  const same = root.querySelector('.g-card > h1')?.textContent === title;
  const heading = h('h1', { tabindex: -1 }, title);
  replace(root, h('section', { className: 'g-card' }, h('p', { className: 'g-eyebrow' }, 'SelectaDJ room'), heading, h('p', {}, text), ...extra));
  // a new screen is said by moving to its heading; one drawn again (a retry) leaves focus alone
  if (!same) heading.focus({ preventScroll: true });
}

function joinScreen(error = ''): void {
  if (!code) {
    screen('No room code', 'Scan the QR code at the party, or type the link you were given.');
    return;
  }
  const button = h('button', { className: 'g-primary', type: 'button', onclick: () => void join(button as HTMLButtonElement) }, 'Join the room');
  screen(
    'Request a song',
    "You'll see what's playing and can ask for songs. Nothing plays on your phone.",
    h('p', { className: 'g-eyebrow' }, 'Room code'),
    h('p', { className: 'g-code' }, shown(code)),
    error ? h('p', { className: 'g-error', role: 'alert' }, error) : null,
    button,
    h('p', { className: 'g-small' }, 'SelectaDJ keeps a random guest id, a scrambled form of your network address, your nickname and your requests, and deletes them 30 days after the room closes. No tracking, no account.'),
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
  // a vote just tapped shows at once, with its count, while the server is asked
  const choice = myVotes.get(item.request_id);
  const voted = choice ?? item.voted;
  const count = Math.max(0, item.votes + (voted === item.voted ? 0 : voted ? 1 : -1));
  const label = voted ? `Remove your vote for ${songLine(item.song)}` : `Vote for ${songLine(item.song)}`;
  return h('button', {
    type: 'button', className: 'g-vote', 'aria-pressed': String(voted), 'aria-label': label, 'aria-busy': choice === undefined ? undefined : 'true',
    onclick: () => void vote(item),
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
    // my requests sit right under the search, where the guest just asked; the notice floats over
    // the bottom of the page (tap it to put it away)
    page = h('div', { id: 'g-shell' },
      h('header', { className: 'g-head', id: 'g-head' }),
      h('div', { id: 'g-banners' }),
      h('div', { id: 'g-now' }),
      searchPanel(),
      h('div', { id: 'g-mine' }),
      h('div', { id: 'g-lists' }),
      h('p', { className: 'g-leave' }, leaving),
      h('div', { className: 'g-dock', id: 'g-dock', 'data-open': notice ? true : undefined },
        h('div', { className: 'g-toast', onclick: () => say('') }, h('p', { id: 'g-notice', className: 'g-notice', role: 'status' }, notice))));
    replace(root, page);
    opened = true;
  }
  const part = (id: string) => document.getElementById(id) as HTMLElement;
  // a screen reader hears the room's name when the room first opens
  if (opened) window.setTimeout(() => { if (!root.contains(document.activeElement)) document.getElementById('g-name')?.focus({ preventScroll: true }); }, 0);
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
  const changed = statusChanges(v);
  patch(parts.head,
    h('p', { className: 'g-eyebrow' }, 'SelectaDJ room'),
    h('h1', { id: 'g-name', tabindex: -1 }, v.room_name),
    v.nickname_confirm ? nameLine(v) : h('p', { className: 'g-muted' }, `You're ${v.nickname}. `, h('button', { type: 'button', className: 'g-link', ...working(busy.has('nicknames')), onclick: () => void nicknames() }, 'Change nickname')),
    v.nickname_confirm && nameSave?.state === 'failed' ? h('p', { className: 'g-error', role: 'alert' }, `${nameSave.name} wasn't saved. ${nameSave.error ?? ''}`.trim(), ' ', h('button', { type: 'button', className: 'g-link', onclick: () => void saveNickname(nameSave?.name ?? '') }, 'Try again')) : null);
  patch(parts.banners,
    v.guest_status === 'pending' ? h('p', { className: 'g-banner' }, "The host hasn't let you in yet. This page will update when they do.") : null,
    v.music_paused ? h('p', { className: 'g-banner' }, "Nothing is playing right now. You can still ask for songs: the host sees each one and adds it to the mix.") : null);
  const active = v.guest_status === 'active';
  // always a title line and a line under it, so the page below never moves when a song starts
  patch(parts.now, active
    ? h('section', { className: 'g-section', 'aria-label': 'Now playing', 'data-key': 'Now playing' },
      h('h2', {}, h('span', { className: 'g-eq', 'aria-hidden': 'true', 'data-on': Boolean(v.now_playing) && !v.music_paused }, h('i'), h('i'), h('i')), 'Now playing'),
      h('p', { className: v.now_playing ? 'g-now' : 'g-now g-muted' }, v.now_playing ? v.now_playing.title : 'No song yet'),
      h('p', { className: 'g-now-by' }, v.now_playing ? v.now_playing.artist : "The song that's playing shows here."))
    : null);
  parts.search.hidden = !(active && v.requests_open);
  if (!parts.search.hidden) { drawResults(); drawBasket(); }
  patch(parts.lists,
    active && !v.requests_open ? section('Requests', h('p', { className: 'g-muted' }, 'Requests are off in this room.')) : null,
    active && v.up_next.length ? section('Up next', h('ol', { className: 'g-list' }, ...v.up_next.slice(0, 3).map((song, index) => songItem(song, `next-${index}-${song.song_id}`)))) : null,
    active && v.coming_up.length ? section('Coming up from guests', h('ol', { className: 'g-list' }, ...v.coming_up.map((item) => songItem(item.song, item.request_id, item.nickname ? h('span', { className: 'g-muted' }, item.nickname) : null, voteButton(item))))) : null,
    active && v.waiting.length ? section('Waiting for the host', h('ul', { className: 'g-list' }, ...v.waiting.map((item) => songItem(item.song, item.request_id, voteButton(item))))) : null);
  // nothing shows here until the guest has asked for something
  patch(parts.mine, active && v.my_requests.length ? myRequests(v) : null);
  if (changed) say(changed);
}

/** Note which of my requests changed status since the last look: they are lit for a moment, and
 * the newest change is returned in words for the notice. */
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
    seen.set(item.request_id, item.status);
  }
  for (const [id, until] of lit) if (until <= now) lit.delete(id);
  return said;
}

function myRequests(v: View): HTMLElement {
  return section('My requests', h('ul', { className: 'g-list' }, ...v.my_requests.map((item) => {
    const leaving = busy.has(`withdraw:${item.request_id}`);
    const row = songItem(item.song, item.request_id,
      PENDING.includes(item.status)
        ? h('button', { type: 'button', className: 'g-quiet', ...working(leaving), 'aria-label': `Withdraw ${songLine(item.song)}`, onclick: () => void withdraw(item.request_id) }, leaving ? 'Withdrawing...' : 'Withdraw')
        : null,
      h('p', { className: `g-status g-${item.status}` }, item.text));
    if (lit.has(item.request_id)) row.className = 'g-changed';
    return row;
  })));
}

function searchPanel(): HTMLElement {
  const results = h('ul', { className: 'g-list', id: 'g-results', 'aria-label': 'Songs found' });
  const input = h('input', {
    id: 'g-q', type: 'search', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    enterkeyhint: 'search', placeholder: 'Title or artist', maxlength: 100, 'aria-describedby': 'g-hint',
  }) as HTMLInputElement;
  // the box stays at the top of the screen while the results scroll under it (guest.css)
  const panel = h('section', { className: 'g-section', id: 'g-search', 'aria-label': 'Request a song' },
    h('h2', {}, 'Request a song'),
    h('div', { className: 'g-search-box' }, h('label', { for: 'g-q' }, 'Search the host\'s songs'), input),
    h('p', { className: 'g-hint', id: 'g-hint' }, 'Type two or more letters, then choose the songs you want.'),
    // said to a screen reader as results come and go; the notice is kept for what the guest did
    h('p', { className: 'g-sr', id: 'g-found', 'aria-live': 'polite' }),
    results,
    h('div', { id: 'g-basket' }));
  let wait = 0;
  // typing waits a moment before asking; Enter asks at once. Either way the list answers the
  // keystroke straight away, with the outline of the rows to come.
  const ask = (delay: number) => {
    window.clearTimeout(wait);
    const query = input.value.trim();
    searchError = '';
    if (query.length < 2) { searchSeq += 1; searching = false; found = []; foundFor = ''; drawResults(); return; }
    searching = true;
    drawResults();
    wait = window.setTimeout(() => void search(query), delay);
  };
  input.addEventListener('input', () => ask(250));
  input.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); ask(0); } });
  // on a phone the keyboard takes half the screen: bring the search to the top, so the results
  // and their buttons sit between the box and the keyboard
  input.addEventListener('focus', () => {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => panel.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' }), 250);
  });
  return panel;
}

/** Whether this song is already one of my requests that's waiting or coming up. */
const asked = (song: Song) => Boolean(view?.my_requests.some((item) => item.song?.song_id === song.song_id && PENDING.includes(item.status)));

const outlineRow = (index: number) => h('li', { className: 'g-skel', 'data-key': `skel-${index}`, 'aria-hidden': 'true' }, h('span', { className: 'g-song' }, h('i'), h('i')), h('i'));

function chosen(song: Song): boolean {
  return basket.some((one) => one.song_id === song.song_id);
}

function choose(song: Song): void {
  if (!chosen(song) && waitingOn(song)) return;
  // taking a song out puts its reason away, unless it is a wait that still holds (the search row says it)
  if (chosen(song) && !waitingOn(song)) whyNot.delete(song.song_id);
  basket = chosen(song) ? basket.filter((one) => one.song_id !== song.song_id) : [...basket, song];
  drawResults();
  drawBasket();
}

// Each match has one button: Choose puts it in the basket, Chosen takes it back out. Once the
// basket holds as many as the room still allows, the rest can't be chosen.
function drawResults(): void {
  const results = document.getElementById('g-results');
  if (!results) return;
  if (searching) results.setAttribute('aria-busy', 'true'); else results.removeAttribute('aria-busy');
  const full = basket.length >= leftNow();
  let rows: HTMLElement[] = [];
  let said = '';
  if (searchError) {
    // what went wrong, and one way on
    const again = () => { searchError = ''; searching = true; drawResults(); void search((document.getElementById('g-q') as HTMLInputElement).value.trim()); };
    rows = [h('li', { className: 'g-empty', 'data-key': 'error' }, h('strong', {}, "The search didn't go through."), `${searchError} `, h('button', { type: 'button', className: 'g-link', onclick: again }, 'Try again'))];
    said = `The search didn't go through. ${searchError}`;
  } else if (found.length) {
    rows = found.map((song) => {
      // a song already asked for says so, and can't be chosen twice
      if (asked(song) && !chosen(song)) {
        return songItem(song, `found-${song.song_id}`, h('button', { type: 'button', className: 'g-quiet g-small-button', 'data-done': true, 'aria-disabled': 'true', 'aria-label': `Requested ${songLine(song)}` }, check(), 'Requested'));
      }
      const picked = chosen(song);
      // a song that can't be asked for yet says why on its row, in place of Choose
      if (!picked && waitingOn(song)) return songItem(song, `found-${song.song_id}`, h('p', { className: 'g-why' }, whyWords(song)));
      return songItem(song, `found-${song.song_id}`, h('button', {
        type: 'button', className: `${picked ? 'g-quiet' : 'g-primary'} g-small-button`, 'aria-pressed': String(picked),
        'aria-label': `${picked ? 'Chosen, press to take out' : 'Choose'} ${songLine(song)}`,
        disabled: !picked && full,
        onclick: () => choose(song),
      }, picked ? check() : null, picked ? 'Chosen' : 'Choose'));
    });
    said = searching ? '' : `${songsWord(found.length)} found.`;
  } else if (searching) {
    rows = [0, 1, 2].map(outlineRow);
    said = 'Searching...';
  } else if (foundFor) {
    rows = [h('li', { className: 'g-empty', 'data-key': 'empty' }, h('strong', {}, `No songs match "${foundFor}".`), "Check the spelling, or try the artist's name.")];
    said = `No songs match "${foundFor}".`;
  }
  patch(results, ...rows);
  const hint = document.getElementById('g-hint');
  if (hint) hint.hidden = rows.length > 0 || basket.length > 0;
  const live = document.getElementById('g-found');
  if (live && live.textContent !== said) live.textContent = said;
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
      h('button', { type: 'button', className: 'g-quiet', 'aria-label': `Take out ${songLine(song)}`, onclick: () => choose(song) }, 'Take out'),
      // why it was not added last time, kept here until it is taken out or sent again
      whyNot.has(song.song_id) ? h('p', { className: waitingOn(song) ? 'g-why' : 'g-why g-why-ready', role: 'status' }, whyWords(song)) : null))) : null,
    // the count and Send stay in reach at the bottom of the screen, above the keyboard (guest.css)
    h('div', { className: 'g-send', 'data-key': 'bar', 'data-on': basket.length > 0 },
      h('p', { className: left <= 0 ? 'g-banner' : 'g-muted', 'data-key': 'left', role: left <= 0 ? 'status' : undefined },
        basket.length ? `${songsWord(basket.length)} chosen. ` : '', words),
      basket.length ? h('button', { type: 'button', className: 'g-primary', 'data-key': 'send', 'aria-busy': sending ? 'true' : undefined, disabled: sending || left <= 0 || basket.every(waitingOn), onclick: () => void sendBasket() },
        sending ? 'Sending...' : basket.length === 1 ? 'Send request' : 'Send requests') : null));
  // the notice floats above that bar, never over it
  const bar = target.querySelector<HTMLElement>('.g-send');
  document.documentElement.style.setProperty('--bar', `${basket.length && bar ? bar.offsetHeight : 0}px`);
}

async function sendBasket(): Promise<void> {
  // a song still waiting out its time stays in the basket with its reason; the rest go
  const held = basket.filter(waitingOn);
  const songs = basket.filter((song) => !waitingOn(song));
  if (sending || !songs.length) return;
  const ticket = ++reads;
  sending = true;
  drawBasket();
  try {
    const answer = await call<{ results: Sent[]; room: View }>(`${base()}/requests/batch`, { method: 'POST', body: JSON.stringify({ song_ids: songs.map((song) => song.song_id) }) });
    const added = answer.results.filter((one) => one.added);
    const refused = answer.results.filter((one) => !one.added);
    const votes = added.filter((one) => one.became_vote).length;
    // what was sent leaves the basket; what was refused stays, so it can go again when there's room
    basket = [...held, ...songs.filter((song) => refused.some((one) => one.song_id === song.song_id))];
    for (const song of songs) whyNot.delete(song.song_id);
    for (const one of refused) {
      whyNot.set(one.song_id, { message: one.message || "This one wasn't added. Try again.", until: one.retry_after_s ? Date.now() + one.retry_after_s * 1000 : undefined, never: one.code === 'not_requestable' });
    }
    watchWaits();
    sending = false;
    if (newer(ticket)) view = answer.room;
    draw();
    say([
      added.length ? `Sent ${songsWord(added.length)}.` : '',
      votes ? `${songsWord(votes)} had been asked for already, so ${votes === 1 ? 'it counts' : 'they count'} as your vote.` : '',
      refused.length === 1 ? "1 song wasn't added: the reason is under it." : refused.length ? `${songsWord(refused.length)} weren't added: the reason is under each one.` : '',
    ].filter(Boolean).join(' '));
  } catch (error) {
    sending = false;
    drawBasket();
    say((error as Error).message);
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
      h('button', { type: 'button', className: 'g-quiet', onclick: () => { picking = false; close(); schedule(); } }, 'Keep my nickname'));
    (root.querySelector('.g-choice') as HTMLElement | null)?.focus();
  } catch (error) {
    draw();
    say((error as Error).message);
  }
}

// ADR-0422: the name line says which nickname the server has, and whether a change is on its way.
function nameLine(v: View): HTMLElement {
  const change = h('button', { type: 'button', className: 'g-link', ...working(busy.has('nicknames')), onclick: () => void nicknames(), disabled: nameSave?.state === 'saving' }, 'Change nickname');
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

async function leave(button: HTMLElement): Promise<void> {
  if (busy.has('leave')) return;
  busy.add('leave');
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
  try {
    await call(`${base()}/leave`, { method: 'POST' });
  } catch { /* leaving locally is enough if the server can't be reached */ }
  busy.delete('leave');
  store(roomKey, null);
  roomId = null;
  view = null;
  basket = [];
  found = [];
  screen('You left the room', 'The host still sees the songs you asked for.', h('button', { type: 'button', className: 'g-primary', onclick: () => joinScreen() }, 'Join again'));
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && roomId) void refresh(); });
  window.addEventListener('online', () => { if (roomId) void refresh(); });
  void refresh();
}
