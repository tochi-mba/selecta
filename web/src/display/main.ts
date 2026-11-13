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

import { ApiError, call, h, replace, Song, songLine } from '../rooms/dom';
import { qrSvg } from '../rooms/qr';
import './display.css';

type Item = { request_id: string; song: Song | null; votes: number; nickname: string | null };
type View = {
  state: 'waiting' | 'paired' | 'expired' | 'ended' | 'unpaired';
  room_name: string | null; code: string | null; join_path: string | null;
  now_playing: Song | null; up_next: Song[]; upcoming: Item[]; music_paused: boolean;
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
  document.body.append(h('p', { className: 'd-reconnecting', id: 'd-reconnecting', role: 'status' }, 'Reconnecting...'));
}

async function disconnect(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = 'Disconnecting...';
  try {
    await call('/api/display/pairing', { method: 'DELETE' });
  } catch { /* gone already, or unreachable: a new pairing replaces the old token either way */ }
  shownCode = '';
  try { await pair(); } catch { failures += 1; replace(root, h('p', {}, 'Reconnecting...')); }
  schedule();
}

async function pair(): Promise<void> {
  const started = await call<{ pairing_code: string; expires_at: number }>('/api/display/pairings', { method: 'POST' });
  pairingCode = started.pairing_code;
  drawPairing();
}

/** The pairing screen for the code we already hold; drawn again after a missed look replaced it. */
function drawPairing(): void {
  shownCode = '';
  replace(root,
    h('section', { className: 'd-pair' },
      h('p', { className: 'd-eyebrow' }, 'SELECTA DISPLAY'),
      h('h1', {}, 'Pair this screen'),
      h('p', {}, 'In SelectaDJ, open your room on Listen, choose Big screen, and type this code:'),
      h('p', { className: 'd-code', id: 'd-pairing', 'aria-label': `Pairing code ${pairingCode.split('').join(' ')}` }, pairingCode),
      h('p', { className: 'd-muted' }, 'The code works once and lasts ten minutes.')));
}

function drawRoom(view: View): void {
  const link = `${location.origin}${view.join_path ?? ''}`;
  let qr = document.getElementById('d-qr');
  if (!qr || shownCode !== view.code) {
    replace(root,
      h('section', { className: 'd-room' },
        h('div', { className: 'd-left' },
          h('p', { className: 'd-eyebrow' }, 'SCAN TO REQUEST A SONG'),
          h('div', { className: 'd-qr', id: 'd-qr' }),
          h('p', { className: 'd-join', id: 'd-join' }),
          h('button', { type: 'button', className: 'd-disconnect', id: 'd-disconnect', onclick: (event: Event) => void disconnect(event.currentTarget as HTMLButtonElement) }, 'Disconnect this screen')),
        h('div', { className: 'd-right', id: 'd-info' })));
    qr = document.getElementById('d-qr') as HTMLElement;
    qr.innerHTML = qrSvg(link, `QR code to join ${view.room_name ?? 'the room'}`); // our own SVG, no user text unescaped
    qr.dataset.link = link;
    shownCode = view.code ?? '';
  }
  replace(document.getElementById('d-join') as HTMLElement, `Or go to ${location.host}${view.join_path ?? ''} and enter `, h('strong', {}, view.code ?? ''));
  replace(document.getElementById('d-info') as HTMLElement,
    h('h1', {}, view.room_name ?? 'Room'),
    view.music_paused ? h('p', { className: 'd-banner' }, "The music's paused.") : null,
    h('h2', {}, 'Now playing'),
    h('p', { className: 'd-now', id: 'd-now' }, view.now_playing ? songLine(view.now_playing) : 'Nothing right now'),
    view.up_next.length ? h('h2', {}, 'Next up') : null,
    view.up_next.length ? h('ol', { className: 'd-list' }, ...view.up_next.slice(0, 3).map((song) => h('li', {}, songLine(song)))) : null,
    h('h2', {}, 'Requests coming up'),
    view.upcoming.length
      ? h('ol', { className: 'd-list', id: 'd-upcoming' }, ...view.upcoming.slice(0, 6).map((item) => h('li', {}, songLine(item.song), item.nickname ? h('span', { className: 'd-muted' }, ` · ${item.nickname}`) : null)))
      : h('p', { className: 'd-muted', id: 'd-upcoming' }, 'No requests yet. Scan the code and ask for a song.'));
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
        replace(root, h('section', { className: 'd-pair' }, h('h1', {}, view.room_name ? `${view.room_name} has ended` : 'The room has ended'), h('p', {}, 'Thanks for coming.')));
      } else if (Date.now() - endedAt > 30_000) { endedAt = 0; await pair(); }
    }
  } catch (error) {
    const problem = error as ApiError;
    if (problem.code === 'flag_off') {
      replace(root, h('section', { className: 'd-pair' }, h('h1', {}, 'The big screen is off'), h('p', {}, problem.message)));
      return;
    }
    if (problem.status === 404) {
      try { await pair(); } catch { failures += 1; }
    } else {
      failures += 1;
      if (root.querySelector('.d-room, #d-pairing')) reconnecting(true);
      else replace(root, h('p', {}, 'Reconnecting...'));
    }
  }
  schedule();
}

void tick();
