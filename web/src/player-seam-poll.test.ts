import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { seam, songs } from './test/backend';

class FakeAudio {
  static now: FakeAudio;
  currentTime = 0;
  destination = {};
  constructor() { FakeAudio.now = this; }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 256, smoothingTimeConstant: 0, connect() {}, getByteFrequencyData() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() };
  }
  async decodeAudioData() { return { duration: 100 }; }
  state: AudioContextState = 'suspended';
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

let clock = 0;
let ready = new Set<string>();
const reads: { key: string; at: number }[] = [];
const tick = (player: SetPlayer) => (player as unknown as { tick(): void }).tick();
const flush = () => new Promise((done) => setTimeout(done, 0));

async function run(player: SetPlayer, seconds: number) {
  for (let step = 0; step < seconds * 10; step += 1) {
    clock += 100;
    tick(player);
    await flush();
  }
}

let player: SetPlayer;
beforeEach(() => {
  clock = 0;
  ready = new Set();
  reads.length = 0;
  vi.stubGlobal('AudioContext', FakeAudio);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const read = /^\/api\/seams\/([^/]+)$/.exec(url);
    if (read) {
      reads.push({ key: read[1], at: clock });
      const done = ready.has(read[1]);
      return new Response(JSON.stringify(done
        ? { status: 'ready', key: read[1], a_source_start: 80, b_source_end: 20, switch_at: 10 }
        : { status: 'rendering', key: read[1] }));
    }
    if (/songs\/\d+\/audio|\/clip/.test(url)) return new Response(new ArrayBuffer(8), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => {
  player.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MI-0162-05: the imminent unrendered seam is read with a backoff', () => {
  it('reads it at once, then at most about once a second, rising to every 5 s', async () => {
    const mix = songs(seam('rendering', 'k'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    await run(player, 60);
    // the old poll read it every ~100 ms: about 600 times in this minute
    expect(reads.length).toBeLessThanOrEqual(16);
    expect(reads.length).toBeGreaterThanOrEqual(10);
    expect(reads[0].at).toBeLessThanOrEqual(100);
    const gaps = reads.slice(1).map((read, index) => read.at - reads[index].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5100);
    expect(gaps.slice(-3).every((gap) => gap >= 4900)).toBe(true);
  });

  it('starts again at once when the seam changes, and keeps to 1 s near the end of the song', async () => {
    const mix = songs(seam('rendering', 'k'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    await run(player, 20);
    const before = reads.length;
    mix[1].seam = seam('rendering', 'other');
    await run(player, 0.2);
    expect(reads.slice(before).map((read) => read.key)).toEqual(['other']);

    FakeAudio.now.currentTime = 75;
    await run(player, 10);
    const late = reads.filter((read) => read.key === 'other' && read.at > clock - 9000);
    expect(late.length).toBeGreaterThanOrEqual(8);
    expect(late.length).toBeLessThanOrEqual(10);
  });

  it('does not hold back a seam that has become ready: the next read picks it up and plans it', async () => {
    const mix = songs(seam('rendering', 'k'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    await run(player, 3);
    ready.add('k');
    FakeAudio.now.currentTime = 72;
    await run(player, 1.2);
    expect(reads.at(-1)).toMatchObject({ key: 'k' });
    expect(player.state.nextReady).toBe(true);
  });
});
