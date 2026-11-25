import { feelOn } from './root';

/** The ambient hue (ADR-0477): a soft tint in the playing song's hue, on its own fixed layer
 * behind content.
 *
 * The hue is the real cover's own where the song has one (found by useMusicFeel on the cover
 * ladder, media/coverLadder.ts), else the one its generated tile is drawn in (views/CoverArt.tsx),
 * so the room and the cover agree. It is published as a bare number, `--ambient-hue` on <html>, once per song
 * change, never as a colour and never per frame: tokens.css turns it into `--ambient-tint`. During
 * a real hand-over the next song's layer cross-fades in over the playing one's by opacity, at most
 * every 70ms, so neither the page root nor the screen's paint changes at frame rate. All of it only while
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

/** The song coming in, during a hand-over: a second layer over the first, in its own hue. */
let incoming: HTMLElement | null = null;
let settling = 0;

function dropLayer() {
  layer?.remove();
  layer = null;
  incoming?.remove();
  incoming = null;
  travelling = false;
}

const wheel = (hue: number) => String(Math.round((((hue % 360) + 360) % 360) * 10) / 10);

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

/** Carry the room from one song's colour to the next during a real hand-over, by the music's real
 * progress. The hue itself is not travelled: a full-screen gradient whose colour changes repaints
 * the whole screen every frame for the length of the hand-over, which on a slow computer with no
 * GPU competes with the audio at the worst moment. Instead the song coming in gets a layer of its
 * own, tinted once, and the two cross-fade by opacity (styles/feel-music.css data-ambient), which
 * the compositor does without painting. Writes on the two layers only, at most every
 * TRAVEL_STEP_MS. Low power's first step turns ambient off, and the travel with it. */
export function travelAmbient(fromHue: number, toHue: number, progress: number, now = performance.now()) {
  if (!feelOn('ambient')) return;
  const base = ensureLayer();
  if (!base || now - lastTravel < TRAVEL_STEP_MS) return;
  lastTravel = now;
  travelling = true;
  if (!incoming || !incoming.isConnected) {
    incoming = document.createElement('div');
    incoming.className = 'ambient-layer';
    incoming.dataset.ambient = 'travel';
    incoming.setAttribute('aria-hidden', 'true');
    incoming.style.opacity = '0';
    base.after(incoming);
  }
  base.dataset.ambient = 'travel';
  // each layer is tinted once per hand-over; only the two opacities change step to step
  const from = wheel(fromHue);
  const to = wheel(toHue);
  if (base.style.getPropertyValue('--ambient-hue') !== from) base.style.setProperty('--ambient-hue', from);
  if (incoming.style.getPropertyValue('--ambient-hue') !== to) incoming.style.setProperty('--ambient-hue', to);
  const share = Math.max(0, Math.min(1, progress));
  base.style.opacity = String(Math.round((1 - share) * 1000) / 1000);
  incoming.style.opacity = String(Math.round(share * 1000) / 1000);
}

/** Hand the room back to the published hue (a hand-over finished, stopped or was skipped). The
 * cross-fade already showed the change, so the one layer takes its hue at once, without the song
 * change's ease, and the incoming layer goes. */
export function endTravel() {
  travelling = false;
  lastTravel = -Infinity;
  incoming?.remove();
  incoming = null;
  if (!layer) return;
  const base = layer;
  base.style.removeProperty('--ambient-hue');
  base.style.removeProperty('opacity');
  if (base.dataset.ambient !== 'travel') return;
  base.dataset.ambient = 'settle';
  // two frames on, the settled values are drawn and the ease for the next song change can return
  if (typeof requestAnimationFrame !== 'function') return;
  if (settling) cancelAnimationFrame(settling);
  settling = requestAnimationFrame(() => {
    settling = requestAnimationFrame(() => {
      settling = 0;
      if (base.dataset.ambient === 'settle') delete base.dataset.ambient;
    });
  });
}

/** For tests. */
export function resetAmbient() {
  root()?.style.removeProperty('--ambient-hue');
  published = null;
  lastTravel = -Infinity;
  if (settling && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(settling);
  settling = 0;
  dropLayer();
}
