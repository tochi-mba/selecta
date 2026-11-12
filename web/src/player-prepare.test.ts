import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREPARE_FALLBACK_MS, PREPARE_IDLE_MS, SetPlayer } from './player';
import { songs } from './test/backend';

/** PF-21: the sound device opens while the browser is idle, ahead of the first Play, so the Play
 * press only resumes it; with no context yet, Play still makes one inside the press. */

class FakeAudio {
  static made = 0;
  static now: FakeAudio;
  currentTime = 0;
  destination = {};
  state: AudioContextState = 'suspended';
  resumes = 0;
  onstatechange: (() => void) | null = null;
  constructor() {
    FakeAudio.made += 1;
    FakeAudio.now = this;
  }
  createGain() {
    const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 256, smoothingTimeConstant: 0, connect() {}, getByteFrequencyData() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() };
  }
  async decodeAudioData() {
    return { duration: 100 };
  }
  async resume() { this.resumes += 1; this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

let player: SetPlayer;
let idle: { run: IdleRequestCallback; timeout?: number }[];

beforeEach(() => {
  FakeAudio.made = 0;
  idle = [];
  vi.stubGlobal('AudioContext', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
  vi.stubGlobal('requestIdleCallback', (run: IdleRequestCallback, options?: IdleRequestOptions) => {
    idle.push({ run, timeout: options?.timeout });
    return idle.length;
  });
});
afterEach(() => {
  player?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const runIdle = () => {
  for (const job of idle.splice(0)) job.run({ didTimeout: false, timeRemaining: () => 50 });
};

describe('PF-21 the sound device opens before the first Play', () => {
  it('prepare() makes the context at an idle moment, not at once, and leaves it suspended', () => {
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    expect(FakeAudio.made).toBe(0);
    expect(idle).toHaveLength(1);
    expect(idle[0].timeout).toBe(PREPARE_IDLE_MS);
    runIdle();
    expect(FakeAudio.made).toBe(1);
    expect(FakeAudio.now.state).toBe('suspended');
    expect(FakeAudio.now.resumes).toBe(0);
  });

  it('Play after prepare only resumes the same context, and playback starts', async () => {
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    runIdle();
    const made = FakeAudio.now;
    await player.togglePause();
    expect(FakeAudio.made).toBe(1);
    expect(FakeAudio.now).toBe(made);
    expect(made.resumes).toBe(1);
    expect(made.state).toBe('running');
    expect(player.state.phase).toBe('playing');
  });

  it('asking again, or after the context exists, makes no second context', async () => {
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    player.prepare();
    expect(idle).toHaveLength(1);
    runIdle();
    player.prepare();
    expect(idle).toHaveLength(0);
    await player.playFrom(0);
    expect(FakeAudio.made).toBe(1);
  });

  it('falls back to Play making the context inside the press when none was prepared', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.togglePause();
    expect(FakeAudio.made).toBe(1);
    expect(FakeAudio.now.resumes).toBe(1);
    expect(player.state.phase).toBe('playing');
  });

  it('Play before the idle moment arrives makes one context, and the late idle call adds none', async () => {
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    await player.togglePause();
    runIdle();
    expect(FakeAudio.made).toBe(1);
    expect(player.state.phase).toBe('playing');
  });

  it('uses a short timer where requestIdleCallback is missing (Safari)', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    // fake only the timer, or the fake clock brings its own requestIdleCallback back
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    vi.advanceTimersByTime(PREPARE_FALLBACK_MS - 1);
    expect(FakeAudio.made).toBe(0);
    vi.advanceTimersByTime(1);
    expect(FakeAudio.made).toBe(1);
  });

  it('a device that refuses at idle leaves Play to make the context, as before', async () => {
    let refuse = true;
    class Refusing extends FakeAudio {
      constructor() {
        if (refuse) throw new Error('device busy');
        super();
      }
    }
    vi.stubGlobal('AudioContext', Refusing);
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    expect(() => runIdle()).not.toThrow();
    refuse = false;
    await player.togglePause();
    expect(FakeAudio.made).toBe(1);
    expect(player.state.phase).toBe('playing');
  });

  it('waits for the page to finish loading before asking for an idle moment', () => {
    const ready = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    expect(idle).toHaveLength(0);
    ready.mockReturnValue('complete');
    window.dispatchEvent(new Event('load'));
    expect(idle).toHaveLength(1);
    runIdle();
    expect(FakeAudio.made).toBe(1);
    ready.mockRestore();
  });

  it('does nothing where Web Audio is missing', () => {
    vi.stubGlobal('AudioContext', undefined);
    player = new SetPlayer(() => songs(), () => {});
    player.prepare();
    expect(idle).toHaveLength(0);
  });
});
