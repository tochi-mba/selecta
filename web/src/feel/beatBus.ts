import type { PlayerLike } from '../playerContract';
import { prefs } from '../state/prefs';
import { createFeatureTracker, createFrameSource, MAX_FLASHES_PER_SECOND, type BeatGrid, type Features } from './musicFeatures';
import { outputDelayMs } from './outputDelay';
import { feelOn, onFeelChange } from './root';

/** The beat bus (ADR-0477 rule 4): chrome that answers the measured music.
 *
 * A screen registers up to four decorative elements (a ring round Play, the player's lit edge, the
 * playing row's wash, a glow, three playing bars). On each kick the analyser measures, or on each
 * beat of the song's analysed grid once the tracker is locked to it, the bus plays one short
 * transform or opacity animation on each of them with element.animate(). Nothing here runs on a
 * timer of its own: no measured hit, no pulse.
 *
 * It reads the same frames and runs the same feature tracker as the Listen visualizer
 * (feel/musicFeatures.ts), through the player's read-only taps or spectrum. Where the player has
 * none (the hosted dock's audio element, or the music playing on another device) the bus stays
 * idle and only the ambient hue is shown (feel/hue.ts).
 *
 * The global CSS switch for reduced motion does not reach script animations, so the bus gates
 * itself: it runs only while `feelOn('music')` (which is off under Still, reduced motion and both
 * low-power steps), the player is playing, the tab is visible and something is registered, and it
 * stops within one frame when any of those ends, settling every target back to its resting CSS. */

export type BeatKind = 'ring' | 'edge' | 'row' | 'glow' | 'bars';

type Animated = 'transform' | 'opacity';

export type MusicMotion = {
  /** The only properties the keyframes touch (a test holds this to transform and opacity). */
  properties: readonly Animated[];
  /** The longest the pulse lasts; it is also held under one beat. */
  maxMs: number;
  /** One pulse, from the peak back to rest. `level` is the hit's strength (or a band's envelope
   * for bars), 0 to 1; `rest` is the element's resting opacity, or the bars' resting scale. */
  keyframes(level: number, rest: number): Keyframe[];
};

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const fixed = (value: number) => String(Math.round(value * 1000) / 1000);

/** The resting height of a playing bar as a share of its full height. styles/feel-music.css draws
 * the same scaleY at rest, so a cancelled pulse lands exactly where the sheet already is. */
export const BAR_REST = 0.3;
/** The most an edge or glow may brighten on a beat. */
export const MAX_LIFT = 0.35;

/** Each kind's pulse. Transform and opacity only, so every one is compositor work. */
export const MUSIC_MOTIONS: Record<BeatKind, MusicMotion> = {
  ring: {
    properties: ['transform', 'opacity'],
    maxMs: 320,
    keyframes: (level, rest) => [
      { transform: 'scale(1)', opacity: fixed(Math.min(1, rest + 0.3 + 0.5 * clamp01(level))) },
      { transform: 'scale(1.12)', opacity: fixed(rest) },
    ],
  },
  edge: {
    properties: ['opacity'],
    maxMs: 260,
    keyframes: (level, rest) => [
      { opacity: fixed(Math.min(1, rest + MAX_LIFT * clamp01(level))) },
      { opacity: fixed(rest) },
    ],
  },
  glow: {
    properties: ['opacity'],
    maxMs: 300,
    keyframes: (level, rest) => [
      { opacity: fixed(Math.min(1, rest + MAX_LIFT * clamp01(level))) },
      { opacity: fixed(rest) },
    ],
  },
  row: {
    properties: ['opacity'],
    maxMs: 240,
    keyframes: (level, rest) => [
      { opacity: fixed(Math.min(1, rest + 0.15 * clamp01(level))) },
      { opacity: fixed(rest) },
    ],
  },
  bars: {
    properties: ['transform'],
    maxMs: 220,
    keyframes: (level, rest) => [
      { transform: `scaleY(${fixed(rest + (1 - rest) * clamp01(level))})` },
      { transform: `scaleY(${fixed(rest)})` },
    ],
  },
};

/** Kinds that belong to the player itself. Subtle keeps only these (ADR-0477 comfort ladder). */
const PLAYER_KINDS: readonly BeatKind[] = ['ring', 'edge', 'bars'];
/** The effects family's curve (tokens.css --motion-ease); a script animation cannot read a token. */
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const MAX_TARGETS = 4;
/** About 30 reads a second, and 15 on a device where the bus's own cost passes FRAME_BUDGET_MS. */
const FRAME_MS = 1000 / 30;
const SLOW_FRAME_MS = 1000 / 15;
const FRAME_BUDGET_MS = 1;
/** With nothing to measure the bus looks again this rarely, so a silent page costs almost nothing. */
const IDLE_MS = 500;
/** WCAG 2.3.1, as the visualizer's flashes: never more than three pulses a second. */
const PULSE_GAP_MS = 1000 / MAX_FLASHES_PER_SECOND + 1;
/** Above this tempo only every other beat pulses. */
const FAST_BPM = 180;
/** A pulse lasts under one beat. */
const BEAT_SHARE = 0.8;
/** How often the energy envelope is written on the registered elements. */
const ENERGY_MS = 250;

/** `endsAt`: when the last pulse's visible part ends, on the performance clock, delay included. */
type Target = { element: HTMLElement; kind: BeatKind; rest: number | null; running: Animation[]; energy: string; endsAt: number };

const targets = new Map<BeatKind, Target>();
let player: PlayerLike | null = null;
let source: ReturnType<typeof createFrameSource> | null = null;
const tracker = createFeatureTracker();
let grid: BeatGrid | null = null;
let frame = 0;
let idle = 0;
let lastTick = -Infinity;
let interval = FRAME_MS;
let cost = 0;
let costFrames = 0;
let lastPhase: number | null = null;
let lastPulse = -Infinity;
let lastEvent = -Infinity;
let beatCount = 0;
const gaps: number[] = [];
let lastEnergy = -Infinity;
let offFeel: (() => void) | null = null;

function running(): boolean {
  return !!player
    && targets.size > 0
    && player.state.phase === 'playing'
    && !(typeof document !== 'undefined' && document.hidden)
    && feelOn('music');
}

function settle(target: Target) {
  for (const animation of target.running) animation.cancel();
  target.running = [];
  if (target.energy) target.element.style.removeProperty('--energy');
  target.energy = '';
}

function halt() {
  if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  if (idle) clearTimeout(idle);
  frame = 0;
  idle = 0;
  for (const target of targets.values()) settle(target);
  tracker.reset();
  lastPhase = null;
  lastEvent = -Infinity;
  gaps.length = 0;
  beatCount = 0;
}

function schedule(delay = 0) {
  if (frame || idle || typeof requestAnimationFrame !== 'function') return;
  if (delay > 0) idle = window.setTimeout(() => { idle = 0; schedule(); }, delay);
  else frame = requestAnimationFrame(tick);
}

/** Start or stop the loop to match the gates. Cheap, so anything that might change one calls it. */
export function beatBusSync() {
  if (running()) schedule();
  else halt();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** The strength of a beat on this frame, or null: an analysed grid beat once locked, else a kick. */
function beatOf(features: Features): number | null {
  if (features.gridLocked) {
    const wrapped = lastPhase !== null && features.beatPhase + 0.5 < lastPhase;
    lastPhase = features.beatPhase;
    if (!wrapped) return null;
    return features.recentBeats[0]?.downbeat ? 1 : 0.7;
  }
  lastPhase = null;
  const kick = features.hits.find((hit) => hit.kind === 'kick');
  return kick ? kick.strength : null;
}

function play(target: Target, level: number, duration: number, bands: readonly number[], now: number) {
  const element = target.element;
  if (typeof element.animate !== 'function') return;
  // the speakers' reported lag (Bluetooth, AirPlay), so the pulse lands when the kick is heard;
  // 0 where the browser reports none, which leaves everything exactly as it was
  const delay = outputDelayMs();
  // one pulse per element at a time: a pulse still running is left to finish, never stacked. With
  // a lag, a pulse still waiting out its delay is not in the way of one that will play after it.
  if (target.running.some((animation) => animation.playState === 'running') && (delay === 0 || target.endsAt > now + delay)) return;
  target.endsAt = now + delay + duration;
  const motion = MUSIC_MOTIONS[target.kind];
  const options: KeyframeAnimationOptions = delay > 0 ? { duration, delay, easing: EASE } : { duration, easing: EASE };
  if (target.kind === 'bars') {
    // low, middle and high bands, one per bar
    const bars = Array.from(element.children).slice(0, 3) as HTMLElement[];
    const levels = [Math.max(bands[0], bands[1]), Math.max(bands[2], bands[3]), Math.max(bands[4], bands[5])];
    target.running = bars.filter((bar) => typeof bar.animate === 'function')
      .map((bar, index) => bar.animate(motion.keyframes(levels[index] ?? 0, BAR_REST), options));
    return;
  }
  if (target.rest === null) target.rest = Number.parseFloat(getComputedStyle(element).opacity) || 0;
  target.running = [element.animate(motion.keyframes(level, target.rest), options)];
}

function pulse(features: Features, now: number) {
  const level = beatOf(features);
  if (level === null) return;
  if (Number.isFinite(lastEvent)) {
    const gap = now - lastEvent;
    if (gap > 200 && gap < 2000) {
      gaps.push(gap);
      if (gaps.length > 8) gaps.shift();
    }
  }
  lastEvent = now;
  beatCount += 1;
  const beatMs = gaps.length >= 2 ? median(gaps) : null;
  // a fast song pulses on every other beat, so the chrome never chatters
  if (beatMs !== null && 60000 / beatMs > FAST_BPM && beatCount % 2 === 1) return;
  if (now - lastPulse < PULSE_GAP_MS) return;
  lastPulse = now;
  const subtle = prefs().motion === 'subtle';
  for (const target of targets.values()) {
    if (subtle && !PLAYER_KINDS.includes(target.kind)) continue;
    const longest = MUSIC_MOTIONS[target.kind].maxMs;
    const duration = Math.round(beatMs !== null ? Math.min(longest, beatMs * BEAT_SHARE) : longest);
    play(target, level, duration, features.bands, now);
  }
}

function energy(features: Features, now: number) {
  if (now - lastEnergy < ENERGY_MS) return;
  lastEnergy = now;
  const value = fixed(Math.round(features.loudness * 100) / 100);
  for (const target of targets.values()) {
    if (target.energy === value) continue;
    target.energy = value;
    target.element.style.setProperty('--energy', value);
  }
}

function tick(timestamp: number) {
  frame = 0;
  if (!running() || !source) {
    halt();
    return;
  }
  if (timestamp - lastTick < interval - 1) {
    schedule();
    return;
  }
  lastTick = timestamp;
  const started = performance.now();
  const input = source.read(started, grid);
  if (!input) {
    // nothing measurable (the analyser is not running yet, or the music is elsewhere): stay still
    tracker.reset();
    lastPhase = null;
    schedule(IDLE_MS);
    return;
  }
  const features = tracker.update(input);
  if (!features.silent) {
    pulse(features, started);
    energy(features, started);
  }
  // the bus's own measured cost; a device where it passes a millisecond reads half as often
  cost = cost * 0.9 + (performance.now() - started) * 0.1;
  costFrames += 1;
  if (costFrames % 30 === 0) interval = cost > FRAME_BUDGET_MS ? SLOW_FRAME_MS : FRAME_MS;
  schedule();
}

function evict(target: Target) {
  settle(target);
  targets.delete(target.kind);
}

/** Elements a newer one of the same kind pushed aside, newest last. When the newer one lets go the
 * one before it answers the beat again, so the mini player gets its ring back when Listen closes. */
const waiting = new Map<BeatKind, HTMLElement[]>();

/** Elements the four-target cap pushed out, oldest first. Without this a fifth kind (Listen's glow
 * over the Shell's ring, edge, bars and playing row) silenced the ring for good, even after Listen
 * closed; now each comes back as soon as a slot frees and its kind is free. */
const displaced: { element: HTMLElement; kind: BeatKind }[] = [];

const fresh = (element: HTMLElement, kind: BeatKind): Target => ({ element, kind, rest: null, running: [], energy: '', endsAt: 0 });

/** Bring cap-displaced elements back while there is room, dropping any that left the page. */
function refill() {
  for (let index = 0; index < displaced.length && targets.size < MAX_TARGETS;) {
    const held = displaced[index];
    if (!held.element.isConnected) displaced.splice(index, 1);
    else if (targets.has(held.kind)) index += 1;
    else {
      displaced.splice(index, 1);
      targets.set(held.kind, fresh(held.element, held.kind));
    }
  }
}

/** Let an element answer the beat. One element per kind (the newest wins, and the one it replaced
 * returns when the newest lets go) and four at once at most (the oldest steps out and returns when
 * a slot frees). The element must be decorative: the bus only ever changes its transform, its
 * opacity and its --energy. Returns a way to let it go, which settles it to rest. */
export function registerBeatTarget(element: HTMLElement, kind: BeatKind): () => void {
  const existing = targets.get(kind);
  if (existing) {
    const queue = waiting.get(kind) ?? [];
    queue.push(existing.element);
    waiting.set(kind, queue);
    evict(existing);
  }
  if (targets.size >= MAX_TARGETS) {
    const oldest = targets.values().next().value;
    if (oldest) {
      displaced.push({ element: oldest.element, kind: oldest.kind });
      evict(oldest);
    }
  }
  targets.set(kind, fresh(element, kind));
  beatBusSync();
  return () => {
    const queue = waiting.get(kind);
    const current = targets.get(kind);
    // compared by element, because a target brought back is a new record for the same element
    if (current?.element !== element) {
      // pushed aside earlier and not answering now: just forget it
      if (queue) waiting.set(kind, queue.filter((held) => held !== element));
      const index = displaced.findIndex((held) => held.element === element);
      if (index >= 0) displaced.splice(index, 1);
      return;
    }
    evict(current);
    let back = queue?.pop();
    while (back && !back.isConnected) back = queue?.pop();
    if (back) targets.set(kind, fresh(back, kind));
    refill();
    beatBusSync();
  };
}

/** The analysed beat grid of the song on screen (the Listen page knows it), or null. Used only once
 * the tracker reports it is locked to the playing position. */
export function setBeatGrid(next: BeatGrid | null) {
  grid = next && next.beats.length > 1 ? next : null;
}

function onVisibility() {
  beatBusSync();
}

/** Point the bus at the player. Returns a stop that halts it and lets the player go. */
export function startBeatBus(next: PlayerLike): () => void {
  if (player !== next) {
    halt();
    player = next;
    source = createFrameSource(next);
  }
  if (!offFeel) {
    offFeel = onFeelChange(beatBusSync);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  }
  beatBusSync();
  return () => {
    if (player !== next) return;
    stopBeatBus();
  };
}

/** Halt the bus and let the player go; registered targets stay registered and at rest. */
export function stopBeatBus() {
  halt();
  player = null;
  source = null;
  offFeel?.();
  offFeel = null;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
}

/** For tests. */
export function resetBeatBus() {
  stopBeatBus();
  for (const target of [...targets.values()]) evict(target);
  waiting.clear();
  displaced.length = 0;
  grid = null;
  interval = FRAME_MS;
  cost = 0;
  costFrames = 0;
  lastTick = -Infinity;
  lastPulse = -Infinity;
  lastEnergy = -Infinity;
}
