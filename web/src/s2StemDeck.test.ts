import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANES, SHAPES, SIDES, StemDeck, type Shape } from './studio';

// T0196: a grid change and a solo are heard straight away, from audio already in the browser.
type Call = [number, number, number];
class FakeGain {
  calls: Call[] = [];
  gain = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: (value: number, at: number, constant: number) => { this.calls.push([value, at, constant]); },
  };
  connect() {}
  disconnect() {}
}
class FakeContext {
  static last: FakeContext;
  currentTime = 1;
  destination = {};
  gains: FakeGain[] = [];
  constructor() { FakeContext.last = this; }
  async resume() {}
  async close() {}
  async decodeAudioData() { return { duration: 8 }; }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBufferSource() { return { buffer: null, loop: false, loopEnd: 0, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() }; }
}

const silent = (): Shape => Object.fromEntries(SIDES.map((side) => [side, Object.fromEntries(LANES.map((lane) => [lane, Array(8).fill(0)]))])) as Shape;
const levelNow = (gain: FakeGain, now: number) => gain.calls.filter(([, at]) => at === now).at(-1)?.[0];

describe('T0196 stem deck response', () => {
  let fetches: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeContext);
    fetches = vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 }));
    vi.stubGlobal('fetch', fetches);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function playing() {
    const deck = new StemDeck(8, 8, silent());
    await deck.load((side, lane) => `/stems/${side}/${lane}`);
    await deck.play();
    return { deck, context: FakeContext.last };
  }

  it('a toggled cell changes that stem’s level at the current audio time, with no network call', async () => {
    const { deck, context } = await playing();
    const loaded = fetches.mock.calls.length;
    context.currentTime = 2.5; // inside cell 1 (one-second cells, started at 1.05)
    const shape = silent();
    shape.a.vocals[1] = 1;
    deck.setShape(shape);
    expect(fetches.mock.calls.length).toBe(loaded);
    const [vocals, ...rest] = context.gains;
    expect(levelNow(vocals, 2.5)).toBe(1);
    expect(vocals.calls.find(([, at]) => at === 2.5)?.[2]).toBeLessThanOrEqual(0.01);
    for (const gain of rest) expect(levelNow(gain, 2.5)).toBe(0);
    deck.close();
  });

  it('solo plays one stem alone straight away, and un-solo puts the grid back', async () => {
    const shape = silent();
    shape.b.drums = Array(8).fill(1);
    const deck = new StemDeck(8, 8, shape);
    await deck.load((side, lane) => `/stems/${side}/${lane}`);
    await deck.play();
    const context = FakeContext.last;
    context.currentTime = 3.2;
    deck.solo('a_bass');
    const order = SIDES.flatMap((side) => LANES.map((lane) => `${side}_${lane}`));
    order.forEach((name, index) => expect(levelNow(context.gains[index], 3.2)).toBe(name === 'a_bass' ? 1 : 0));
    context.currentTime = 3.4;
    deck.solo(null);
    order.forEach((name, index) => expect(levelNow(context.gains[index], 3.4)).toBe(name === 'b_drums' ? 1 : 0));
    deck.close();
  });
});

describe('T0201 every ready-made shape', () => {
  it.each(SHAPES.map((preset) => [preset.name, preset] as const))('%s gives a whole 2 x 4 x 8 grid of on/off squares without touching the old one', (_name, preset) => {
    const before = silent();
    const frozen = JSON.stringify(before);
    const after = preset.change(before);
    expect(JSON.stringify(before)).toBe(frozen);
    for (const side of SIDES) for (const lane of LANES) {
      expect(after[side][lane]).toHaveLength(8);
      for (const cell of after[side][lane]) expect([0, 1]).toContain(cell);
    }
    expect(JSON.stringify(after)).not.toBe(frozen);
    // the second song is fully in by the last square, so the transition always lands
    expect(LANES.some((lane) => after.b[lane][7] === 1)).toBe(true);
  });
});
