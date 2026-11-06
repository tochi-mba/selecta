import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { fakeBackend, seam, songs } from './test/backend';

class FakeAudio {
  static now: FakeAudio;
  currentTime = 0;
  destination = {};
  constructor() {
    FakeAudio.now = this;
  }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 256,
      smoothingTimeConstant: 0,
      connect() {},
      getByteFrequencyData(data: Uint8Array) { data.fill(96); },
    };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  async decodeAudioData() {
    return { duration: 100 };
  }
  async resume() {}
  async suspend() {}
}

function audioBackend(missing: number[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const song = /songs\/(\d+)\/audio/.exec(url);
      if (song && missing.includes(Number(song[1]))) return new Response('{}', { status: 404 });
      if (song) return new Response(new ArrayBuffer(8), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
}

const tick = (player: SetPlayer) => (player as unknown as { tick(): void }).tick();
const settle = () => new Promise((done) => setTimeout(done, 20));

describe('playing through a mix', () => {
  it('records actual exposure across seeks instead of counting the seek as heard', async () => {
    audioBackend([]);
    const mix = songs(seam('none', 'a'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 12;
    await player.playFrom(0, 80);
    FakeAudio.now.currentTime = 17;
    await player.skip();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/playback/skip');
    const feedback = JSON.parse(call![1]!.body as string);
    expect(feedback.song_id).toBe(1);
    expect(feedback.heard_seconds).toBeCloseTo(16.9);
    expect(feedback.source_position).toBeCloseTo(84.95);
  });
  let player: SetPlayer;
  beforeEach(() => vi.stubGlobal('AudioContext', FakeAudio));
  afterEach(() => player.stop());

  it('never shows a time past the end of the song', async () => {
    audioBackend([]);
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 90;
    tick(player);
    expect(player.state.songTime).toBeLessThanOrEqual(100);
    (player as unknown as { current: { startedAt: number } }).current.startedAt = -1000;
    tick(player);
    expect(player.state.songTime).toBeLessThanOrEqual(100);
  });

  it('skips a song that won’t load instead of going silent', async () => {
    audioBackend([2]);
    const mix = songs(seam('none', 'a'), seam('none', 'b'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 98;
    tick(player);
    await settle();
    expect(player.state.position).toBe(2);
    expect(player.state.phase).toBe('playing');
  });

  it('stops and says why when the last song won’t load', async () => {
    audioBackend([2]);
    const mix = songs(seam('none', 'a'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 98;
    tick(player);
    await settle();
    expect(player.state.phase).toBe('idle');
    expect(player.state.notice).toContain('wouldn’t load');
  });

  it('asks for the next seam once, even if it’s already waiting in line', async () => {
    const calls = fakeBackend({ 'POST /mix/1/render': {} });
    const fetchFake = vi.mocked(fetch);
    const answer = fetchFake.getMockImplementation()!;
    fetchFake.mockImplementation(async (url, init) =>
      String(url).includes('/audio') ? new Response(new ArrayBuffer(8)) : answer(url, init),
    );
    const mix = songs(seam('queued', 'a'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    tick(player);
    tick(player);
    expect(calls.filter((call) => call.path === '/mix/1/render')).toHaveLength(1);
  });
});
