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
import type { Pulse } from '../guest/social/social';

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

/** The line under the playing song: the room's hearts, and a word when it loved the blend. */
export function line(pulse: Pulse | undefined): HTMLElement | null {
  const play = pulse?.play;
  if (!pulse || !play || !pulse.shows.reactions) return null;
  if (!play.loves && !pulse.blend_loved) return null;
  return h('p', { className: 'd-social', 'data-key': 'social' },
    play.loves ? h('span', { className: 'd-loves', 'data-key': 'loves' }, heart('d-heart'), lovesWord(play.loves)) : null,
    pulse.blend_loved ? h('span', { className: 'd-loved', 'data-key': `loved-${play.play_id}` }, 'The room loved that blend') : null);
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
