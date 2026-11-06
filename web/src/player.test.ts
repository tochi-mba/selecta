import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { fakeBackend, seam, songs } from './test/backend';

class FakeAudio {
  static now: FakeAudio;
  currentTime = 0;
  destination = {};
  sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
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
    const source = { buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source;
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


describe('transition readiness deadlines', () => {
  it('keeps the seam active after the display handoff and stops its remaining audio', async () => {
    audioBackend([]);
    const mix = songs(seam('ready', 'tail', { a_source_start: 20, b_source_end: 40, switch_at: 10 }));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    await settle();
    const clip = FakeAudio.now.sources[1];
    FakeAudio.now.currentTime = 31;
    tick(player);
    expect(player.state.position).toBe(1);
    expect(player.state.inSeam).toBe(true);
    player.stop();
    expect(clip.stop).toHaveBeenCalled();
    expect(player.state.inSeam).toBe(false);
  });

  it('ignores a failed fallback download after the listener seeks elsewhere', async () => {
    audioBackend([]);
    const original = vi.mocked(fetch).getMockImplementation()!;
    let reject!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, fail) => { reject = fail; });
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === '/api/songs/2/audio') return pending;
      return original(url, init);
    });
    const mix = songs(seam('rendering', 'waiting'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0, 98);
    await player.playFrom(0, 10);
    reject(new Error('download failed'));
    await settle();
    expect(player.state.phase).toBe('playing');
    expect(player.state.position).toBe(0);
    expect(player.state.notice).toBe('');
  });

  it('loads a completed render without waiting for the whole mix to refresh', async () => {
    audioBackend([]);
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === '/api/seams/late') return new Response(JSON.stringify({
        status: 'ready', key: 'late', a_source_start: 80, b_source_end: 20, switch_at: 10,
      }));
      return original(url, init);
    });
    const mix = songs(seam('rendering', 'late'));
    const refresh = vi.fn();
    player = new SetPlayer(() => mix, refresh);
    await player.playFrom(0, 79.9);
    await settle();
    expect(mix[1].seam?.state.status).toBe('rendering');
    expect(refresh).toHaveBeenCalled();
    expect(FakeAudio.now.sources).toHaveLength(3);
    expect(FakeAudio.now.sources[1].start.mock.calls[0][0]).toBeCloseTo(0.15);
  });

  let player: SetPlayer;
  beforeEach(() => vi.stubGlobal('AudioContext', FakeAudio));
  afterEach(() => player.stop());
  it.each([0.2, 0.01, 0])('uses audio ready %s seconds before the cue', async (lead) => {
    audioBackend([]);
    const mix = songs(seam('rendering', 'late'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 80.05 - lead;
    mix[1].seam = seam('ready', 'late', { a_source_start: 80, b_source_end: 20, switch_at: 10 });
    tick(player);
    await settle();
    expect(FakeAudio.now.sources).toHaveLength(3);
    expect(FakeAudio.now.sources[1].start).toHaveBeenCalledWith(80.05);
  });
  it('does not start a seam after its cue', async () => {
    audioBackend([]);
    player = new SetPlayer(() => songs(seam('ready', 'late', { a_source_start: 80, b_source_end: 20 })), () => {});
    await player.playFrom(0, 81);
    await settle();
    expect(FakeAudio.now.sources).toHaveLength(1);
  });
  it('preserves a ready cue inside the end-fade window', async () => {
    audioBackend([]);
    player = new SetPlayer(() => songs(seam('ready', 'late', { a_source_start: 99, b_source_end: 20, switch_at: 10 })), () => {});
    await player.playFrom(0, 98);
    await settle();
    expect(player.state.position).toBe(0);
    expect(player.state.notice).not.toContain('faded');
    expect(FakeAudio.now.sources).toHaveLength(3);
    expect(FakeAudio.now.sources[1].start).toHaveBeenCalledWith(1.05);
  });
  it.each(['edit', 'stop', 'seek'])('discards an in-flight seam after %s', async (action) => {
    audioBackend([]);
    const original = vi.mocked(fetch).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/clip')) await gate;
      return original(url, init);
    });
    const mix = songs(seam('ready', 'old', { a_source_start: 80, b_source_end: 20 }));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    if (action === 'edit') mix[1].seam = seam('rendering', 'replacement');
    if (action === 'stop') player.stop();
    if (action === 'seek') await player.playFrom(0, 90);
    const before = FakeAudio.now.sources.length;
    release();
    await settle();
    expect(FakeAudio.now.sources).toHaveLength(before);
  });
});

describe('going past the way out of a song', () => {
  let player: SetPlayer;
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudio);
  });
  afterEach(() => {
    player?.stop();
    vi.unstubAllGlobals();
  });

  const asked = () => (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([url]) => url.includes('leave-later'));

  it('asks for another further on, once', async () => {
    audioBackend([]);
    const mix = songs(seam('ready', 'gone', { a_source_start: 30, b_source_end: 10, switch_at: 5 }));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0, 50);
    tick(player);
    tick(player);
    await settle();
    expect(asked()).toHaveLength(1);
    expect(asked()[0][0]).toBe('/api/mix/1/leave-later');
    expect(JSON.parse(asked()[0][1]?.body as string).after).toBeGreaterThanOrEqual(50);
  });

  it('leaves it alone while the way out is still ahead', async () => {
    audioBackend([]);
    const mix = songs(seam('ready', 'ahead', { a_source_start: 80, b_source_end: 10, switch_at: 5 }));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0, 50);
    tick(player);
    await settle();
    expect(asked()).toHaveLength(0);
  });

  it('leaves it alone while it isn’t ready, since it might land anywhere', async () => {
    audioBackend([]);
    const mix = songs(seam('rendering', 'pending', { a_source_start: 30 }));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0, 50);
    tick(player);
    await settle();
    expect(asked()).toHaveLength(0);
  });
});
