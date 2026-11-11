import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { seam, songs } from '../test/backend';

/* T0105 (ADR-0006): the transport cases player.test.ts doesn't already pin down.
 * Pause during a seam, key repeat on Next, decoding errors, suspend/resume and
 * gapless continuity, all against a fake Web Audio clock. */

type Source = { buffer: { duration: number } | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };

class FakeAudio {
  static now: FakeAudio;
  static undecodable = new Set<number>();
  currentTime = 0;
  destination = {};
  state: AudioContextState = 'suspended';
  onstatechange: (() => void) | null = null;
  sources: Source[] = [];
  constructor() {
    FakeAudio.now = this;
  }
  createGain() {
    const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 8, smoothingTimeConstant: 0, connect() {}, getByteFrequencyData() {} };
  }
  createBufferSource() {
    const source: Source & { connect(): void; disconnect(): void } = {
      buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
  /** Songs are 100 s; a seam clip (4 bytes) is 10 s. Marked songs fail to decode. */
  async decodeAudioData(bytes: ArrayBuffer) {
    const marker = new Uint8Array(bytes)[0];
    if (FakeAudio.undecodable.has(marker)) throw new DOMException('Unable to decode audio data', 'EncodingError');
    return { duration: bytes.byteLength === 4 ? 10 : 100 };
  }
  async resume() { this.state = 'running'; this.onstatechange?.(); }
  async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
}

function audioBackend() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const song = /songs\/(\d+)\/audio/.exec(url);
    if (song) {
      const bytes = new Uint8Array(8);
      bytes[0] = Number(song[1]);
      return new Response(bytes.buffer, { status: 200 });
    }
    if (/seams\/[^/]+\/clip/.test(url)) return new Response(new ArrayBuffer(4), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

const tick = (player: SetPlayer) => (player as unknown as { tick(): void }).tick();
const settle = () => new Promise((done) => setTimeout(done, 20));
const startOf = (source: Source) => source.start.mock.calls[0]?.[0] as number;
const audible = () => FakeAudio.now.sources.filter((source) => source.start.mock.calls.length && !source.stop.mock.calls.length);

let player: SetPlayer;
beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudio);
  FakeAudio.undecodable.clear();
  window.localStorage.clear();
  audioBackend();
});
afterEach(() => {
  player?.stop();
  vi.unstubAllGlobals();
});

/** Mix: song 0 into song 1 with a ready seam whose cue is 2 s ahead of the start offset. */
async function intoALiveSeam() {
  const mix = songs(seam('ready', 'a', { a_source_start: 30, b_source_end: 10, switch_at: 20 }), seam('none', 'b'));
  player = new SetPlayer(() => mix, () => {});
  await player.playFrom(0, 28);
  tick(player);
  await settle();
  FakeAudio.now.currentTime = 5; // past the cue at 2.05: the transition is sounding
  tick(player);
  return mix;
}

describe('T0105 pause, seek and Next during a seam', () => {
  it('pausing mid-seam holds the sound and carries on from the same scheduled audio', async () => {
    await intoALiveSeam();
    expect(player.state.inSeam).toBe(true);
    const started = FakeAudio.now.sources.filter((source) => source.start.mock.calls.length).length;
    const stops = FakeAudio.now.sources.map((source) => source.stop.mock.calls.length);
    await player.togglePause();
    expect(player.state.phase).toBe('paused');
    expect(FakeAudio.now.state).toBe('suspended');
    await player.togglePause();
    expect(player.state.phase).toBe('playing');
    tick(player);
    expect(player.state.inSeam).toBe(true);
    // Nothing was restarted or cut: the clip and the next song keep their schedule.
    expect(FakeAudio.now.sources.filter((source) => source.start.mock.calls.length)).toHaveLength(started);
    expect(FakeAudio.now.sources.map((source) => source.stop.mock.calls.length)).toEqual(stops);
  });

  it('seek and Next mid-seam are refused with a reason and leave the seam sounding', async () => {
    await intoALiveSeam();
    const before = audible().length;
    await player.seek(10);
    expect(player.state.notice).toMatch(/transition is playing/i);
    await player.next();
    expect(player.state.notice).toMatch(/Already on the way/);
    expect(audible()).toHaveLength(before);
  });
});

describe('T0105 repeated keys', () => {
  it('a held-down Next never stacks songs and never runs past the end', async () => {
    const mix = songs(seam('none', 'a'), seam('none', 'b'), seam('none', 'c'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    // Key repeat fires faster than a song can load.
    await Promise.all([player.next(), player.next(), player.next()]);
    await settle();
    expect(player.state.phase).toBe('playing');
    expect(player.state.position).toBeGreaterThanOrEqual(1);
    expect(audible()).toHaveLength(1);
    for (let press = 0; press < 8; press += 1) await player.next();
    expect(player.state.position).toBe(mix.length - 1);
    expect(player.state.phase).toBe('playing');
    expect(audible()).toHaveLength(1);
  });

  it('repeated play/pause toggles end in a consistent state', async () => {
    player = new SetPlayer(() => songs(seam('none', 'a')), () => {});
    await player.playFrom(0);
    for (let press = 0; press < 5; press += 1) await player.togglePause();
    expect(player.state.phase).toBe('paused');
    expect(FakeAudio.now.state).toBe('suspended');
    await player.togglePause();
    expect(player.state.phase).toBe('playing');
    expect(audible()).toHaveLength(1);
  });
});

describe('T0105 end of mix', () => {
  it('the last song finishing goes quiet and idle, without inventing a next song', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 101;
    tick(player);
    expect(player.state.phase).toBe('idle');
    expect(player.state.position).toBe(0);
    expect(FakeAudio.now.sources).toHaveLength(1);
  });
});

describe('T0105 decoding errors', () => {
  it('a song whose audio cannot be decoded stops with an honest reason', async () => {
    FakeAudio.undecodable.add(1);
    player = new SetPlayer(() => songs(seam('none', 'a')), () => {});
    await player.playFrom(0);
    expect(player.state.phase).toBe('idle');
    expect(player.state.notice).toBe('That song’s audio couldn’t be read.');
    expect(audible()).toHaveLength(0);
  });

  it('an undecodable next song is skipped at the fade instead of going silent', async () => {
    FakeAudio.undecodable.add(2);
    const mix = songs(seam('none', 'a'), seam('none', 'b'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 98;
    tick(player);
    await settle();
    expect(player.state.position).toBe(2);
    expect(player.state.phase).toBe('playing');
    expect(player.state.notice).toMatch(/faded in|skipped/);
  });
});

describe('T0105 suspend and resume', () => {
  it('a system suspension shows as paused, never resumes by itself, and resumes in place on Play', async () => {
    player = new SetPlayer(() => songs(seam('none', 'a')), () => {});
    await player.playFrom(0, 40);
    FakeAudio.now.currentTime = 5;
    tick(player);
    const at = player.state.songTime;
    FakeAudio.now.state = 'suspended';
    FakeAudio.now.onstatechange?.();
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toMatch(/interrupted/);
    await settle();
    expect(FakeAudio.now.state).toBe('suspended');
    await player.togglePause();
    expect(player.state.phase).toBe('playing');
    tick(player);
    expect(player.state.songTime).toBeCloseTo(at, 5);
    expect(audible()).toHaveLength(1);
  });
});

describe('T0105 gapless continuity', () => {
  it('a ready seam overlaps outgoing song, clip and incoming song with no gap', async () => {
    const mix = songs(seam('ready', 'a', { a_source_start: 30, b_source_end: 10, switch_at: 20 }));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0, 28);
    tick(player);
    await settle();
    const [outgoing, clip, incoming] = FakeAudio.now.sources;
    const cue = startOf(clip);
    expect(cue).toBeCloseTo(0.05 + 2, 5);
    const outgoingEnd = outgoing.stop.mock.calls.at(-1)![0] as number;
    expect(outgoingEnd).toBeGreaterThan(cue); // the clip starts before the old song stops
    expect(startOf(incoming)).toBeLessThan(cue + 10); // the next song starts before the clip ends
  });

  it('a fallback fade brings the next song in before this one ends', async () => {
    const mix = songs(seam('none', 'a'));
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(0);
    FakeAudio.now.currentTime = 98;
    tick(player);
    await settle();
    const [outgoing, incoming] = FakeAudio.now.sources;
    const outgoingEnd = startOf(outgoing) + 100;
    expect(startOf(incoming)).toBeLessThan(outgoingEnd);
    expect(player.state.position).toBe(1);
    expect(player.state.notice).toMatch(/faded in/);
  });
});
