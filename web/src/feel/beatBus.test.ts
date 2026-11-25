import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerLike } from '../playerContract';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { BAR_REST, MUSIC_MOTIONS, registerBeatTarget, resetBeatBus, startBeatBus, type BeatKind } from './beatBus';
import type { Features } from './musicFeatures';
import { resetFeel, startFeel } from './root';

/** FL-0477-04, the truth rule (ADR-0477 rule 4): chrome moves only on a measured kick or an
 * analysed beat, only while music plays on a visible tab with the music part on, and never faster
 * than three pulses a second.
 *
 * The analyser and the feature tracker are stood in for: each frame the test says what the tracker
 * measured (a kick, silence, nothing), so what is proven here is the bus's own gating, pacing and
 * animation choices, not the kick detector (musicFeatures has its own tests). */

const fake = vi.hoisted(() => ({
  features: null as Features | null,
  input: true,
}));

vi.mock('./musicFeatures', async (importOriginal) => {
  const real = await importOriginal<typeof import('./musicFeatures')>();
  return {
    ...real,
    createFrameSource: () => ({ read: (now: number) => (fake.input ? { now, db: null, sampleRate: 48000 } : null) }),
    createFeatureTracker: () => ({ update: () => fake.features, reset: () => undefined }),
  };
});

function measured(change: Partial<Features> = {}): Features {
  return {
    silent: false, hits: [], bands: [0.9, 0.2, 0.5, 0.1, 0.7, 0.3], loudness: 0.5,
    gridLocked: false, beatPhase: 0, recentBeats: [],
    ...change,
  } as unknown as Features;
}
const kick = (strength = 0.8) => measured({ hits: [{ at: 0, kind: 'kick', strength, position: 0 }] });

type FakeAnimation = { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; playState: AnimationPlayState; cancel: () => void };
let animations: FakeAnimation[] = [];
/** Whether a new fake animation keeps running until cancelled, or is over at once. */
let lasting = false;
let pending: FrameRequestCallback | null = null;
let clock = 0;
let player: { state: { phase: string } };
let stops: (() => void)[] = [];

/** Deliver one animation frame at `at` ms, with the tracker measuring `features`. */
function frame(at: number, features: Features | null = measured()) {
  fake.features = features;
  const run = pending;
  pending = null;
  clock = at;
  run?.(at);
}

function target(kind: BeatKind, bars = false): HTMLElement {
  const element = document.createElement('span');
  if (bars) for (let i = 0; i < 3; i += 1) element.append(document.createElement('i'));
  document.body.append(element);
  return element;
}

const on = (element: Element) => animations.filter((animation) => animation.element === element);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  localStorage.clear();
  reloadPrefs();
  setPrefs({ motion: 'expressive' });
  resetFeel();
  animations = [];
  lasting = false;
  pending = null;
  clock = 1000;
  fake.input = true;
  stops = [startFeel()];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { pending = null; }));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
    const made: FakeAnimation = {
      element: this,
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
      playState: lasting ? 'running' : 'finished',
      cancel() { made.playState = 'idle'; },
    };
    animations.push(made);
    return made as unknown as Animation;
  };
  player = { state: { phase: 'playing' } };
});

afterEach(() => {
  for (const stop of stops) stop();
  resetBeatBus();
  resetFeel();
  delete (Element.prototype as Partial<Element>).animate;
  delete (document as { hidden?: boolean }).hidden;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function start() {
  stops.push(startBeatBus(player as unknown as PlayerLike));
}

describe('FL-0477-04 the beat bus only moves on measured music', () => {
  it('a measured kick plays one short animation on each registered target', () => {
    const ring = target('ring');
    const edge = target('edge');
    stops.push(registerBeatTarget(ring, 'ring'), registerBeatTarget(edge, 'edge'));
    start();
    frame(1000, kick());
    expect(on(ring)).toHaveLength(1);
    expect(on(edge)).toHaveLength(1);
    expect(on(ring)[0].options.duration).toBeLessThanOrEqual(MUSIC_MOTIONS.ring.maxMs);
    // a frame without a kick pulses nothing
    frame(1400, measured());
    expect(animations).toHaveLength(2);
  });

  it('plays nothing while paused, and asks for no frames', () => {
    player.state.phase = 'paused';
    stops.push(registerBeatTarget(target('ring'), 'ring'));
    start();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    frame(1000, kick());
    expect(animations).toHaveLength(0);
  });

  it('stops within one frame of a pause and settles a running pulse back to rest', () => {
    lasting = true;
    const ring = target('ring');
    stops.push(registerBeatTarget(ring, 'ring'));
    start();
    frame(1000, kick());
    expect(on(ring)[0].playState).toBe('running');
    player.state.phase = 'paused';
    frame(1400, kick());
    expect(on(ring)).toHaveLength(1);
    expect(on(ring)[0].playState).toBe('idle');
    expect(pending).toBeNull();
  });

  it('plays nothing while the tab is hidden', () => {
    stops.push(registerBeatTarget(target('ring'), 'ring'));
    start();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    frame(1000, kick());
    expect(animations).toHaveLength(0);
  });

  it('plays nothing under Still, reduced motion or low power', () => {
    stops.push(registerBeatTarget(target('ring'), 'ring'));
    start();
    setPrefs({ motion: 'still' });
    frame(1000, kick());
    expect(animations).toHaveLength(0);

    setPrefs({ motion: 'expressive' });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    frame(2000, kick());
    expect(animations).toHaveLength(0);

    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { pending = null; }));
    for (const level of ['lite', 'auto']) {
      document.documentElement.dataset.lowPower = level;
      frame(3000, kick());
      expect(animations).toHaveLength(0);
    }
    delete document.documentElement.dataset.lowPower;
  });

  it('asks for no frames at all with nothing registered', () => {
    start();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    frame(1000, kick());
    expect(animations).toHaveLength(0);
  });

  it('silence pulses nothing, even with a kick in the frame', () => {
    stops.push(registerBeatTarget(target('ring'), 'ring'));
    start();
    for (let at = 1000; at < 3000; at += 100) frame(at, measured({ silent: true, hits: [{ at, kind: 'kick', strength: 1, position: 0 }] }));
    expect(animations).toHaveLength(0);
  });

  it('with nothing to measure it stays still and looks again only after a long wait', () => {
    fake.input = false;
    stops.push(registerBeatTarget(target('ring'), 'ring'));
    start();
    frame(1000, kick());
    expect(animations).toHaveLength(0);
    expect(pending).toBeNull();
    vi.advanceTimersByTime(499);
    expect(pending).toBeNull();
    vi.advanceTimersByTime(1);
    expect(pending).not.toBeNull();
  });
});

describe('FL-0477-04 pacing', () => {
  it('never pulses more than three times a second, however many kicks arrive', () => {
    const ring = target('ring');
    stops.push(registerBeatTarget(ring, 'ring'));
    start();
    // a kick on every frame for three seconds
    for (let at = 1000; at < 4000; at += 34) frame(at, kick());
    expect(on(ring).length).toBeGreaterThan(0);
    expect(on(ring).length).toBeLessThanOrEqual(9);
  });

  it('a song at 160 BPM pulses on every beat, one above 180 BPM on every other', () => {
    const ring = target('ring');
    stops.push(registerBeatTarget(ring, 'ring'));
    start();
    for (let beat = 0; beat < 11; beat += 1) frame(1000 + beat * 375, kick());
    expect(on(ring)).toHaveLength(11);

    resetBeatBus();
    animations = [];
    const fast = target('ring');
    stops.push(registerBeatTarget(fast, 'ring'));
    start();
    // 187.5 BPM: the three-a-second cap alone would allow six of these eleven
    for (let beat = 0; beat < 11; beat += 1) frame(20000 + beat * 320, kick());
    expect(on(fast)).toHaveLength(5);
    // and each pulse is held under one beat
    for (const animation of on(fast).slice(1)) expect(Number(animation.options.duration)).toBeLessThan(320);
  });

  it('never starts a second animation on an element while one is running', () => {
    lasting = true;
    const ring = target('ring');
    stops.push(registerBeatTarget(ring, 'ring'));
    start();
    frame(1000, kick());
    frame(1500, kick());
    frame(2000, kick());
    expect(on(ring)).toHaveLength(1);
    on(ring)[0].playState = 'finished';
    frame(2500, kick());
    expect(on(ring)).toHaveLength(2);
  });
});

describe('FL-0477-04 what a pulse may touch', () => {
  const ALLOWED = new Set(['transform', 'translate', 'scale', 'opacity']);
  const META = new Set(['offset', 'easing', 'composite']);

  it('every kind animates only transform, translate, scale or opacity', () => {
    for (const [kind, motion] of Object.entries(MUSIC_MOTIONS)) {
      for (const property of motion.properties) expect(ALLOWED.has(property), `${kind} ${property}`).toBe(true);
      for (const level of [0, 0.5, 1, 2]) {
        for (const keyframe of motion.keyframes(level, kind === 'bars' ? BAR_REST : 0.4)) {
          for (const key of Object.keys(keyframe)) {
            if (META.has(key)) continue;
            expect(ALLOWED.has(key), `${kind} ${key}`).toBe(true);
            expect(motion.properties as readonly string[]).toContain(key);
          }
        }
      }
    }
  });

  it('the animations actually played keep to those properties, bars one per band', () => {
    const kinds: BeatKind[] = ['ring', 'edge', 'glow', 'bars'];
    for (const kind of kinds) stops.push(registerBeatTarget(target(kind, kind === 'bars'), kind));
    start();
    frame(1000, kick());
    // three bars and three single elements
    expect(animations).toHaveLength(6);
    for (const animation of animations) {
      for (const keyframe of animation.keyframes) {
        for (const key of Object.keys(keyframe)) if (!META.has(key)) expect(ALLOWED.has(key)).toBe(true);
      }
    }
    expect(animations.filter((animation) => animation.element.tagName === 'I')).toHaveLength(3);
  });

  it('never writes a style property on the page root during frames', () => {
    const rootStyle = vi.spyOn(document.documentElement.style, 'setProperty');
    const ring = target('ring');
    stops.push(registerBeatTarget(ring, 'ring'));
    start();
    for (let at = 1000; at < 4000; at += 34) frame(at, kick());
    expect(rootStyle).not.toHaveBeenCalled();
    // the loudness envelope goes on the registered element only
    expect(ring.style.getPropertyValue('--energy')).toBe('0.5');
  });

  it('Subtle keeps only the player kinds', () => {
    setPrefs({ motion: 'subtle' });
    const ring = target('ring');
    const row = target('row');
    stops.push(registerBeatTarget(ring, 'ring'), registerBeatTarget(row, 'row'));
    start();
    frame(1000, kick());
    expect(on(ring)).toHaveLength(1);
    expect(on(row)).toHaveLength(0);
  });
});

describe('FL-0477-04 registered targets', () => {
  it('a replaced target returns when the newer one lets go', () => {
    const mini = target('ring');
    const listen = target('ring');
    stops.push(registerBeatTarget(mini, 'ring'));
    const letGo = registerBeatTarget(listen, 'ring');
    start();
    frame(1000, kick());
    expect(on(listen)).toHaveLength(1);
    expect(on(mini)).toHaveLength(0);
    letGo();
    frame(2000, kick());
    expect(on(mini)).toHaveLength(1);
    expect(on(listen)).toHaveLength(1);
  });

  it('a replaced target that left the page does not come back', () => {
    const gone = target('ring');
    stops.push(registerBeatTarget(gone, 'ring'));
    const letGo = registerBeatTarget(target('ring'), 'ring');
    gone.remove();
    letGo();
    start();
    frame(1000, kick());
    expect(animations).toHaveLength(0);
  });

  it('holds four targets at most, letting the oldest go', () => {
    const elements = (['ring', 'edge', 'glow', 'row', 'bars'] as BeatKind[]).map((kind) => {
      const element = target(kind, kind === 'bars');
      stops.push(registerBeatTarget(element, kind));
      return element;
    });
    start();
    frame(1000, kick());
    expect(on(elements[0])).toHaveLength(0);
    for (const element of elements.slice(1, 4)) expect(on(element)).toHaveLength(1);
  });
});
