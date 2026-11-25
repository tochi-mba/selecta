// The big screen's full-bleed colour (ADR-0477 ambient, ADR-0478 "real or clearly generated").
//
// The colour is the playing song's own hue, the same number the app draws that song's cover tile
// and ambient layer in, so the TV, the host's screen and the phones agree on a song's colour. It is
// worked out from the song's id, never from the audio: it says which song is on, not how it sounds.
//
// The room feed carries no hand-over progress, so the colour changes when the song changes, easing
// slowly on the screen (display.css). When nothing is playing the layer fades out; while the music
// is paused it stays, dimmer, because the song is still the one on.

import { h, type Song } from '../rooms/dom';

/** The stable hue (0 to 359) for a song id: a djb2 hash with xor. A copy of artHue in
 * web/src/feel/hue.ts, kept here so the display's small bundle never loads the app's feel engine;
 * ambient.test.ts holds the two equal. */
export function songHue(seed: string | number): number {
  const text = String(seed);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash % 360;
}

/** The one decorative layer behind everything on the screen, made the first time it is needed. */
function layer(): HTMLElement {
  const found = document.getElementById('d-ambient');
  if (found) return found;
  const made = h('div', { className: 'd-ambient', id: 'd-ambient', 'aria-hidden': 'true' });
  document.body.prepend(made);
  return made;
}

/** Tint the screen in the playing song's hue; `song` null fades the tint away. */
export function paintAmbient(song: Song | null, paused: boolean): void {
  const target = layer();
  if (!song) {
    target.removeAttribute('data-on');
    target.removeAttribute('data-paused');
    return;
  }
  const hue = String(songHue(song.song_id));
  // set only when the song changes, so the slow ease runs once per song and never per look
  if (target.style.getPropertyValue('--ambient-hue') !== hue) target.style.setProperty('--ambient-hue', hue);
  target.setAttribute('data-on', '');
  if (paused) target.setAttribute('data-paused', ''); else target.removeAttribute('data-paused');
}
