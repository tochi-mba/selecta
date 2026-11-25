import { feelOn } from './root';

/** The ambient hue (ADR-0477): a soft tint in the playing song's hue, on its own fixed layer
 * behind content.
 *
 * The hue is the same one the song's cover tile is drawn in (views/CoverArt.tsx), so the room and
 * the tile agree. It is published as a bare number, `--ambient-hue` on <html>, once per song
 * change, never as a colour and never per frame: tokens.css turns it into `--ambient-tint`. During
 * a real hand-over the number travels from one song's hue to the next on the ambient layer alone,
 * at most every 70ms, so the page root is never restyled at frame rate. All of it only while
 * `feelOn('ambient')`; the blind listening study keeps the feel off (rule 11). */

/** The stable hue (0 to 359) for a song id or name: a djb2 hash with xor, as the cover tile uses. */
export function artHue(seed: string | number): number {
  return artHash(seed) % 360;
}

/** The whole hash, for the cover tile's turn as well as its hue. */
export function artHash(seed: string | number): number {
  const text = String(seed);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash;
}

/** How far through a hand-over the music is, 0 to 1, from the song clock, where the hand-over
 * began and its switch point (seconds after the start). The same sum the Listen hand-over bar
 * draws, kept here so the ambient layer and that bar can never disagree. */
export function handoverProgress(time: number, seamAt: number, switchAt: number | undefined): number {
  return Math.max(0, Math.min(1, (time - seamAt) / Math.max(switchAt ?? 0, 0.01)));
}

/** The short way round the colour wheel from one hue to another, at `progress` (0 to 1). */
export function mixHue(fromHue: number, toHue: number, progress: number): number {
  const step = ((((toHue - fromHue) % 360) + 540) % 360) - 180;
  const at = fromHue + step * Math.max(0, Math.min(1, progress));
  return Math.round((((at % 360) + 360) % 360) * 10) / 10;
}

/** The ambient layer travels no faster than the audio clock's own handoff bar (--motion-clock). */
export const TRAVEL_STEP_MS = 70;

let layer: HTMLElement | null = null;
let published: number | null = null;
let lastTravel = -Infinity;
let travelling = false;

function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

/** The one ambient layer: a decorative, fixed, empty element at the start of <body>, behind all
 * content (styles/feel-music.css). Made here rather than in a component so no screen has to carry
 * it, and so travelling it never re-renders React. */
function ensureLayer(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'ambient-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.prepend(layer);
  return layer;
}

function dropLayer() {
  layer?.remove();
  layer = null;
  travelling = false;
}

/** Publish the playing song's hue, or null when nothing is playing. Called once per song change;
 * the stylesheet eases the change with --motion-slow. With ambient off it clears everything. */
export function publishAmbientHue(hue: number | null) {
  const html = root();
  if (!html) return;
  if (hue === null || !feelOn('ambient')) {
    if (published !== null) html.style.removeProperty('--ambient-hue');
    published = null;
    dropLayer();
    return;
  }
  const value = Math.round((((hue % 360) + 360) % 360) * 10) / 10;
  ensureLayer();
  // the layer follows the page again once a hand-over is over
  if (travelling) endTravel();
  if (value === published) return;
  published = value;
  html.style.setProperty('--ambient-hue', String(value));
}

/** Move the ambient layer's hue part of the way to the next song's, during a real hand-over. Writes
 * on the layer only, and at most every TRAVEL_STEP_MS. */
export function travelAmbient(fromHue: number, toHue: number, progress: number, now = performance.now()) {
  if (!feelOn('ambient')) return;
  const target = ensureLayer();
  if (!target || now - lastTravel < TRAVEL_STEP_MS) return;
  lastTravel = now;
  travelling = true;
  target.style.setProperty('--ambient-hue', String(mixHue(fromHue, toHue, progress)));
}

/** Hand the layer back to the published hue (a hand-over finished, stopped or was skipped). */
export function endTravel() {
  travelling = false;
  lastTravel = -Infinity;
  layer?.style.removeProperty('--ambient-hue');
}

/** For tests. */
export function resetAmbient() {
  root()?.style.removeProperty('--ambient-hue');
  published = null;
  lastTravel = -Infinity;
  dropLayer();
}
