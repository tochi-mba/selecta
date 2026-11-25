// What a room does together, on the big screen (ADR-0488).
//
// The screen only ever adds a shared view: everything here also happens, complete, on the
// phones. It reads the same pulse the phones read, carried in its own view, and draws what the
// host has left switched on for the screen (`shows`).
//
// Hearts rise when the room's count for the playing song goes up between two looks. That is a
// room answering a song, never something moving on a timer, and nothing rises under reduced
// motion: the count simply changes.

import { h } from '../rooms/dom';
import type { Pulse, Round } from '../guest/social/social';

const SPACE = 'http://www.w3.org/2000/svg';
const HEART = 'M8 13.4S2.6 10 2.6 6.3A2.9 2.9 0 0 1 8 4.8a2.9 2.9 0 0 1 5.4 1.5C13.4 10 8 13.4 8 13.4z';
const MOST_AT_ONCE = 12;

let lastPlay = '';
let lastLoves = 0;

function heart(className: string): SVGElement {
  const mark = document.createElementNS(SPACE, 'svg');
  mark.setAttribute('class', className);
  mark.setAttribute('viewBox', '0 0 16 16');
  mark.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SPACE, 'path');
  line.setAttribute('d', HEART);
  mark.append(line);
  return mark;
}

const lovesWord = (count: number) => (count === 1 ? '1 love' : `${count} loves`);

/** The line under the playing song: the dedication a guest chose for it, the room's hearts,
 * and a word when it loved the blend. Each only while the host shows it on the screen. */
export function line(pulse: Pulse | undefined): HTMLElement | null {
  const play = pulse?.play;
  if (!pulse || !play) return null;
  const said = pulse.shows.dedications ? pulse.dedication : null;
  const loves = pulse.shows.reactions ? play.loves : 0;
  const loved = Boolean(pulse.shows.reactions && pulse.blend_loved);
  if (!said && !loves && !loved) return null;
  return h('p', { className: 'd-social', 'data-key': 'social' },
    said ? h('span', { className: 'd-dedication', 'data-key': `dedication-${said.request_id}` }, said.from ? `${said.words} From ${said.from}.` : said.words) : null,
    loves ? h('span', { className: 'd-loves', 'data-key': 'loves' }, heart('d-heart'), lovesWord(loves)) : null,
    loved ? h('span', { className: 'd-loved', 'data-key': `loved-${play.play_id}` }, 'The room loved that blend') : null);
}

// --- Pick the next song -------------------------------------------------------------------

let ticking = 0;
const clock = (seconds: number): string => {
  const left = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
};

const RESULT_WORDS: Record<string, string> = {
  waiting: 'Going into the mix.',
  in_mix: 'It plays next.',
  not_placed: 'It couldn’t go into the mix this time.',
  no_votes: 'Nobody voted, so the DJ carries on.',
  no_song: 'None of those songs can be played right now, so the DJ carries on.',
  called_off: 'The host called off the vote.',
};

/** Keep the countdown's digits moving between looks, on the server's clock. */
function tick(round: Round, skew: number): void {
  window.clearInterval(ticking);
  ticking = window.setInterval(() => {
    const shown = document.getElementById('d-round-left');
    const left = round.closes_at - (Date.now() / 1000 + skew);
    if (!shown || left <= 0) { window.clearInterval(ticking); return; }
    shown.textContent = clock(left);
  }, 1000);
}

/** The vote, large: the songs offered, their bars and the time left, then what the room picked.
 * It takes the place of the lists while it shows; the code to join stays where it is. */
export function roundPanel(pulse: Pulse | undefined): HTMLElement | null {
  const round = pulse?.shows.rounds ? pulse.round : null;
  if (!pulse || !round) { window.clearInterval(ticking); return null; }
  const skew = pulse.now - Date.now() / 1000;
  const open = round.state === 'open' && round.closes_at > pulse.now;
  if (open) tick(round, skew); else window.clearInterval(ticking);
  const winner = round.options.find((option) => option.position === round.winner);
  const result = round.state === 'closed' && winner
    ? `The room picked ${winner.song?.title ?? 'a song'}. ${RESULT_WORDS[round.outcome ?? 'waiting'] ?? ''}`.trim()
    : RESULT_WORDS[round.outcome ?? ''] ?? 'The vote has closed.';
  return h('div', { className: 'd-round', 'data-key': `round-${round.round_id}`, 'data-state': open ? 'open' : round.state },
    h('h2', { 'data-key': 'round-title' }, 'Pick the next song', open ? h('span', { className: 'd-round-left', id: 'd-round-left' }, clock(round.closes_at - pulse.now)) : null),
    open ? h('p', { className: 'd-muted d-round-how', 'data-key': 'round-how' }, 'Vote on your phone.') : h('p', { className: 'd-round-result', 'data-key': 'round-result' }, result),
    h('ol', { className: 'd-round-list', 'data-key': 'round-list' }, ...round.options.map((option) => {
      const share = round.total > 0 ? Math.round((option.votes / round.total) * 100) : 0;
      const won = !open && round.winner === option.position;
      return h('li', { className: won ? 'd-round-opt d-round-won' : 'd-round-opt', 'data-key': `opt-${option.position}` },
        h('span', { className: 'd-song' }, h('strong', {}, option.song?.title ?? 'A song'), h('span', { className: 'd-muted' }, option.song?.artist ?? '')),
        h('span', { className: 'd-round-count' }, String(option.votes)),
        h('span', { className: 'd-round-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${share}%` })));
    })));
}

/** Let a heart rise for each love since the last look, a dozen at most, each from its own spot. */
export function rise(pulse: Pulse | undefined): void {
  const play = pulse?.play;
  if (!pulse || !play || !pulse.shows.reactions) { lastPlay = ''; lastLoves = 0; return; }
  const fresh = play.play_id === lastPlay ? play.loves - lastLoves : 0;
  lastPlay = play.play_id;
  lastLoves = play.loves;
  if (fresh <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let layer = document.getElementById('d-rising');
  if (!layer) {
    layer = h('div', { className: 'd-rising', id: 'd-rising', 'aria-hidden': 'true' });
    document.body.append(layer);
  }
  for (let index = 0; index < Math.min(fresh, MOST_AT_ONCE); index += 1) {
    const mark = heart('d-rise');
    // spread across the lower left of the screen, under the song, a little apart in time
    mark.style.left = `${8 + Math.random() * 44}%`;
    mark.style.animationDelay = `${index * 90}ms`;
    mark.addEventListener('animationend', () => mark.remove());
    layer.append(mark);
  }
}
