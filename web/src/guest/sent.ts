// "Sent" on the guest page (ADR-0477): a short arc that carries the tick from the Send button into
// place, and where the request now stands in the room's line, rolling up to its number.
//
// The place comes from the room's own answer to the send, never from a guess: the first song just
// sent that the room lists among the guests' songs coming up, or else among those waiting for the
// host. A room that lists it in neither says nothing about a place. The number rolls once, from 1,
// for a moment; a screen reader hears only the final words, and with reduced motion the number is
// simply there.

import { h } from '../rooms/dom';

const SPACE = 'http://www.w3.org/2000/svg';

type Listed = { song: { song_id: number } | null; mine: boolean };
export type Place = { place: number; list: 'coming' | 'waiting' };

/** Where the first of `songIds` stands in the room's line, from the room's answer to the send. */
export function placeOf(room: { coming_up: Listed[]; waiting: Listed[] }, songIds: readonly number[]): Place | null {
  const ours = (item: Listed) => item.mine && item.song !== null && songIds.includes(item.song.song_id);
  const coming = room.coming_up.findIndex(ours);
  if (coming >= 0) return { place: coming + 1, list: 'coming' };
  const waiting = room.waiting.findIndex(ours);
  if (waiting >= 0) return { place: waiting + 1, list: 'waiting' };
  return null;
}

/** The words for a place, whole, as a screen reader hears them. */
export function placeWords(place: Place): string {
  return place.list === 'coming' ? `Number ${place.place} in the guests’ songs coming up.` : `Number ${place.place} waiting for the host.`;
}

/** The tick in its circle, with the arc it travelled drawn round it. Decoration only. */
export function sentMark(check: Element): HTMLElement {
  const arc = document.createElementNS(SPACE, 'svg');
  arc.setAttribute('class', 'g-arc');
  arc.setAttribute('viewBox', '0 0 32 32');
  arc.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SPACE, 'path');
  // most of a circle, open at the upper left where the tick came in
  path.setAttribute('d', 'M16 3a13 13 0 1 1-11.26 6.5');
  path.setAttribute('pathLength', '1');
  arc.append(path);
  return h('span', { className: 'g-tick g-tick-sent', 'aria-hidden': 'true' }, arc, check);
}

/** The place line: the words a screen reader hears, and the number that is seen, apart. */
export function placeLine(place: Place): HTMLElement {
  const before = 'Number ';
  const after = place.list === 'coming' ? ' in the guests’ songs coming up.' : ' waiting for the host.';
  return h('span', { className: 'g-place', 'data-key': `place-${place.list}-${place.place}` },
    h('span', { className: 'g-sr' }, placeWords(place)),
    h('span', { 'aria-hidden': 'true' }, before, h('b', { className: 'g-place-number', 'data-to': String(place.place) }, String(place.place)), after));
}

/** How long the roll takes: twice the page's own --motion-slow, which the system's reduced motion
 * setting does not change, so that is asked separately. */
function rollMs(): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const slow = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-slow'));
  return Number.isFinite(slow) ? slow * 2 : 0;
}

/** Roll a place number up from 1 to its value, once, on the next frames; it ends on the value. */
export function rollPlace(node: HTMLElement | null): void {
  if (!node) return;
  const to = Number(node.dataset.to);
  const span = rollMs();
  if (!Number.isFinite(to) || to <= 1 || !span || typeof requestAnimationFrame !== 'function') return;
  const start = performance.now();
  const step = (time: number) => {
    // a redraw may have written the final number already; a node gone from the page is left alone
    if (!node.isConnected) return;
    const done = Math.min(1, (time - start) / span);
    const eased = 1 - (1 - done) ** 3;
    node.textContent = String(Math.max(1, Math.round(1 + (to - 1) * eased)));
    if (done < 1) requestAnimationFrame(step);
  };
  node.textContent = '1';
  requestAnimationFrame(step);
}
