// The big-screen display at /display: a TV or projector shows a pairing code, the host types it
// into the room panel, and from then on the screen shows the room's QR code, what's playing,
// what's coming up and "Scan to request a song". It never plays audio and can't change anything.
//
// Its read-only token is an HttpOnly cookie; the page never sees it. The pairing is tied to the
// room, not the code, so when the host makes a new code the next look shows the new QR. If the
// power, the network or the server drops, the page shows a calm "Reconnecting..." and keeps
// asking (backing off to 15 s), then picks up by itself with the same token: no new code.
// When the host disconnects the screen, the next look says `unpaired` and a new code appears;
// "Disconnect this screen" does the same from the screen's side.

import { ApiError, call, h, patch, replace, Song } from '../rooms/dom';
import { qrSvg } from '../rooms/qr';
import './display.css';

type Item = { request_id: string; song: Song | null; votes: number; nickname: string | null };
type View = {
  state: 'waiting' | 'paired' | 'expired' | 'ended' | 'unpaired';
  room_name: string | null; code: string | null; join_path: string | null;
  now_playing: Song | null; up_next: Song[]; upcoming: Item[]; music_paused: boolean;
  /** ADR-0475 D29: the speaker's state, said as the guest page says it; absent is ready. */
  music?: 'ready' | 'choosing' | 'reconnecting' | 'none' | null;
};
/** The second screen says what guests are told while the room has no device playing. */
const MUSIC_WORDS: Record<string, { title: string; more: string }> = {
  choosing: { title: 'The host is choosing where the music plays.', more: 'Scan the code to ask for a song.' },
  reconnecting: { title: 'The music is paused while the host’s device reconnects.', more: 'Requests are kept.' },
  none: { title: 'The host hasn’t connected any music yet.', more: 'Scan the code to ask for a song.' },
};

const POLL_MS = 3000;
const MAX_WAIT_MS = 15_000;
const root = document.getElementById('display') as HTMLElement;
let pairingCode = '';
let timer = 0;
let failures = 0;
let shownCode = '';
let endedAt = 0;

function schedule(ms = POLL_MS): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void tick(), Math.min(MAX_WAIT_MS, ms * 2 ** failures));
}

/** A quiet note over whatever is showing while the server can't be reached. */
function reconnecting(on: boolean): void {
  const note = document.getElementById('d-reconnecting');
  if (!on) { note?.remove(); return; }
  if (note) return;
  document.body.append(h('p', { className: 'd-reconnecting', id: 'd-reconnecting', role: 'status' }, h('i', { className: 'd-spin', 'aria-hidden': 'true' }), 'Reconnecting...'));
}

async function disconnect(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Disconnecting...';
  try {
    await call('/api/display/pairing', { method: 'DELETE' });
  } catch { /* gone already, or unreachable: a new pairing replaces the old token either way */ }
  shownCode = '';
  try { await pair(); } catch { failures += 1; replace(root, waiting('Reconnecting...')); }
  schedule();
}

/** The product's mark and name, over whatever the screen shows. */
function brand(): HTMLElement {
  return h('p', { className: 'd-brand' }, h('i', { className: 'd-mark', 'aria-hidden': 'true' }), 'SelectaDJ');
}

/** A calm full-screen line while there is nothing else to show yet. */
function waiting(text: string): HTMLElement {
  return h('p', { className: 'd-waiting', role: 'status' }, h('i', { className: 'd-spin', 'aria-hidden': 'true' }), text);
}

/** A whole-screen message: the room ended, or the big screen is off. */
function notice(title: string, text: string): HTMLElement {
  return h('section', { className: 'd-pair' }, brand(), h('h1', {}, title), h('p', { className: 'd-lede' }, text));
}

async function pair(): Promise<void> {
  const started = await call<{ pairing_code: string; expires_at: number }>('/api/display/pairings', { method: 'POST' });
  pairingCode = started.pairing_code;
  drawPairing();
}

/** The pairing screen for the code we already hold; drawn again after a missed look replaced it. */
function drawPairing(): void {
  shownCode = '';
  const step = (number: string, text: string) => h('li', {}, h('span', { className: 'd-step', 'aria-hidden': 'true' }, number), text);
  replace(root,
    h('section', { className: 'd-pair' },
      brand(),
      h('h1', {}, 'Pair this screen'),
      h('ol', { className: 'd-steps' },
        step('1', 'Open your room in SelectaDJ'),
        step('2', 'Find Big screen'),
        step('3', 'Type this code')),
      // one box a letter, so it reads from the sofa; the label says it letter by letter
      h('p', { className: 'd-sr' }, `Pairing code ${pairingCode.split('').join(' ')}`),
      h('p', { className: 'd-code', id: 'd-pairing', 'aria-hidden': 'true' }, ...pairingCode.split('').map((letter) => h('span', {}, letter))),
      h('p', { className: 'd-muted' }, 'The code works once and lasts ten minutes.')));
}

/** A song on the big screen: its place, its title, then its artist (and who asked) more quietly. */
function line(song: Song | null, key: string, by: string | null = null): HTMLElement {
  return h('li', { 'data-key': key },
    h('span', { className: 'd-song' }, h('strong', {}, song?.title ?? 'A song'), h('span', { className: 'd-muted' }, [song?.artist, by ? `asked by ${by}` : ''].filter(Boolean).join(' · '))));
}

function drawRoom(view: View): void {
  const link = `${location.origin}${view.join_path ?? ''}`;
  let qr = document.getElementById('d-qr');
  if (!qr || shownCode !== view.code) {
    replace(root,
      h('section', { className: 'd-room' },
        h('div', { className: 'd-right', id: 'd-info' }),
        h('aside', { className: 'd-left' },
          h('p', { className: 'd-eyebrow' }, 'Scan to request a song'),
          h('div', { className: 'd-qr', id: 'd-qr' }),
          h('p', { className: 'd-join', id: 'd-join' }),
          h('button', { type: 'button', className: 'd-disconnect', id: 'd-disconnect', onclick: (event: Event) => void disconnect(event.currentTarget as HTMLButtonElement) }, 'Disconnect this screen'))));
    qr = document.getElementById('d-qr') as HTMLElement;
    qr.innerHTML = qrSvg(link, `QR code to join ${view.room_name ?? 'the room'}`); // our own SVG, no user text unescaped
    qr.dataset.link = link;
    shownCode = view.code ?? '';
  }
  // for a phone with no camera to hand: the address, and the room code large enough to read from the back
  patch(document.getElementById('d-join') as HTMLElement,
    h('span', { className: 'd-label' }, 'Room code'),
    h('strong', { className: 'd-roomcode' }, view.code ?? ''),
    h('span', { className: 'd-url' }, `No camera? Open ${location.host}${view.join_path ?? ''}`));
  // Patched in place and keyed by song, so the screen stays still between looks and only a line
  // that is new (the next song, a new request) arrives.
  const waitingOn = view.music ? MUSIC_WORDS[view.music] : undefined;
  const now = waitingOn ? null : view.now_playing;
  const playing = Boolean(now) && !view.music_paused;
  const next = view.up_next.slice(0, 3);
  patch(document.getElementById('d-info') as HTMLElement,
    h('header', { className: 'd-top', 'data-key': 'top' }, brand(), h('h1', {}, view.room_name ?? 'Room')),
    h('div', { className: 'd-playing', 'data-key': 'playing', 'data-on': playing },
      h('h2', { 'data-key': 'now-title' }, h('span', { className: 'd-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), waitingOn ? (view.music === 'reconnecting' ? 'Paused' : 'Waiting') : now && view.music_paused ? 'Paused' : 'Now playing'),
      h('p', { className: now ? 'd-now' : 'd-now d-muted', id: 'd-now', 'data-key': `now-${now?.song_id ?? view.music ?? 'none'}` }, now ? now.title : waitingOn ? waitingOn.title : 'Nothing playing yet', h('span', { className: 'd-by' }, now ? now.artist : waitingOn ? waitingOn.more : 'Scan the code and pick the first song.'))),
    h('div', { className: 'd-lists', 'data-key': 'lists' },
      next.length ? h('div', { 'data-key': 'next-col' },
        h('h2', { 'data-key': 'next-title' }, 'Up next'),
        h('ol', { className: 'd-list', 'data-key': 'next' }, ...next.map((song) => line(song, `next-${song.song_id}`)))) : null,
      h('div', { 'data-key': 'asked-col' },
        h('h2', { 'data-key': 'asked-title' }, 'Requests coming up'),
        view.upcoming.length
          ? h('ol', { className: 'd-list', id: 'd-upcoming' }, ...view.upcoming.slice(0, next.length ? 3 : 5).map((item) => line(item.song, item.request_id, item.nickname)))
          : h('p', { className: 'd-muted d-none', id: 'd-upcoming' }, 'No requests yet. Scan the code and ask for a song.'))));
}

async function tick(): Promise<void> {
  try {
    const view = await call<View>('/api/display/view');
    failures = 0;
    reconnecting(false);
    if (view.state === 'unpaired') { shownCode = ''; await pair(); }
    else if (view.state === 'paired') { endedAt = 0; drawRoom(view); }
    else if (view.state === 'expired' || (view.state === 'waiting' && !pairingCode)) await pair();
    else if (view.state === 'waiting' && !document.getElementById('d-pairing')) drawPairing();
    else if (view.state === 'ended') {
      if (!endedAt) {
        endedAt = Date.now();
        replace(root, notice(view.room_name ? `${view.room_name} has ended` : 'The room has ended', 'Thanks for coming.'));
      } else if (Date.now() - endedAt > 30_000) { endedAt = 0; await pair(); }
    }
  } catch (error) {
    const problem = error as ApiError;
    if (problem.code === 'flag_off') {
      replace(root, notice('The big screen is off', problem.message));
      return;
    }
    if (problem.status === 404) {
      try { await pair(); } catch { failures += 1; }
    } else {
      failures += 1;
      if (root.querySelector('.d-room, #d-pairing')) reconnecting(true);
      else replace(root, waiting('Reconnecting...'));
    }
  }
  schedule();
}

void tick();
