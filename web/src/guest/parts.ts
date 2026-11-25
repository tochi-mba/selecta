// Small drawn pieces of the guest page: icons, a song's artwork tile, a song row and a status chip.
// Everything is drawn (SVG paths, initials), never typed as a glyph, so no font can change it.

import { h, Song, songLength } from '../rooms/dom';

const SPACE = 'http://www.w3.org/2000/svg';
// 16 x 16, stroked with the text colour (guest.css .g-icon)
const PATHS = {
  check: 'M3 8.5l3.2 3.2L13 5',
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.4 10.4L14 14',
  up: 'M4 10l4-4 4 4',
  note: 'M6 12.5V3.5l7-1.5v9M6 12.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM13 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  person: 'M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM2.75 13.5c.6-2.2 2.7-3.5 5.25-3.5s4.65 1.3 5.25 3.5',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.75V8l2.25 1.5',
  off: 'M2 2l12 12M4.2 7.2a5.4 5.4 0 0 1 1.6-1M8 5a5.6 5.6 0 0 1 4 1.9M6.3 9.6a2.6 2.6 0 0 1 3.4 0M8 12.25h.01',
  lock: 'M4 7.5h8v6H4zM5.75 7.5V5.25a2.25 2.25 0 0 1 4.5 0V7.5',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z',
  heart: 'M8 13.4S2.6 10 2.6 6.3A2.9 2.9 0 0 1 8 4.8a2.9 2.9 0 0 1 5.4 1.5C13.4 10 8 13.4 8 13.4z',
} as const;
export type IconName = keyof typeof PATHS;

export function icon(name: IconName, extra = ''): Element {
  const mark = document.createElementNS(SPACE, 'svg');
  mark.setAttribute('class', `g-icon g-icon-${name}${extra ? ` ${extra}` : ''}`);
  mark.setAttribute('viewBox', '0 0 16 16');
  mark.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SPACE, 'path');
  line.setAttribute('d', PATHS[name]);
  // a check draws itself in (guest.css g-draw), so its length is one
  if (name === 'check') line.setAttribute('pathLength', '1');
  mark.append(line);
  return mark;
}

/** Up to two letters for a song with no artwork: the first letters of its title's first words. */
export function initials(title: string): string {
  const words = title.replace(/\(.*?\)|\[.*?\]/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase();
}

/** One of five tints, always the same for the same song. */
function tone(song: Song): number {
  let sum = 0;
  for (const letter of `${song.title}|${song.artist}`) sum = (sum * 31 + letter.charCodeAt(0)) % 9973;
  return sum % 5;
}

/** A song's artwork tile: its initials on a tint, or a note when there is no song. `extra` is
 * drawn over it (the check of a chosen song, the bars of the one playing). */
export function art(song: Song | null, size = '', ...extra: (Node | null)[]): HTMLElement {
  return h('span', { className: size ? `g-art g-art-${size}` : 'g-art', 'data-tone': song ? tone(song) : undefined, 'aria-hidden': 'true' },
    song ? h('span', { className: 'g-art-text' }, initials(song.title) || null) : icon('note'), ...extra);
}

/** Three bars that say music is playing: standing at three heights while it plays, low and soft
 * when it is paused or nothing is on. Still either way, as the room feed has no beat to follow. */
export function bars(on: boolean): HTMLElement {
  return h('span', { className: 'g-eq', 'aria-hidden': 'true', 'data-on': on }, h('i'), h('i'), h('i'));
}

/** A song's two lines: title, then artist and length. */
export function songText(song: Song | null, ...extra: (Node | string | null)[]): HTMLElement {
  return h('span', { className: 'g-song' },
    h('strong', {}, song?.title ?? 'A song'),
    h('span', { className: 'g-meta' }, song ? `${song.artist} · ${songLength(song.length_s)}` : ''), ...extra);
}

export type Tone = 'wait' | 'ok' | 'next' | 'live' | 'done' | 'no' | 'gone';

/** A request's status in a few words, with a drawn mark for what kind it is. */
export function chip(kind: Tone, label: string): HTMLElement {
  const mark = kind === 'live' ? bars(true) : kind === 'ok' || kind === 'done' ? icon('check') : h('i', { className: 'g-dot' });
  return h('span', { className: `g-chip g-chip-${kind}`, 'data-key': `chip-${kind}` }, mark, label);
}

/** The outline of a result row while the answer is on its way. */
export const outlineRow = (index: number): HTMLElement => h('li', { className: 'g-skel g-skel-row', 'data-key': `skel-${index}`, 'aria-hidden': 'true' }, h('i', { className: 'g-skel-art' }), h('span', { className: 'g-song' }, h('i'), h('i')), h('i', { className: 'g-skel-pill' }));

/** An empty or closed state: a drawn mark, one line, and one line of what to do. */
export function empty(mark: IconName, title: string, text: string, key = 'empty'): HTMLElement {
  return h('div', { className: 'g-empty', 'data-key': key }, h('span', { className: 'g-empty-mark', 'aria-hidden': 'true' }, icon(mark)), h('strong', {}, title), text ? h('span', {}, text) : null);
}
