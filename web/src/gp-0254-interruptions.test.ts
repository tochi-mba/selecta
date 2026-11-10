import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { songs } from './test/backend';

/** GP-0254: what the player does when the physical output or the system takes the sound away.
 * The browser can only say that devices changed or that the audio context stopped, so the player
 * never claims to know whether anything is audible, and never resumes after a deliberate Pause. */

class FakeAudio {
  static now: FakeAudio;
  currentTime = 0;
  destination = {};
  state: AudioContextState = 'suspended';
  onstatechange: (() => void) | null = null;
  resumes = 0;
  constructor() { FakeAudio.now = this; }
  createGain() {
    const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 8, smoothingTimeConstant: 0, connect() {}, getByteFrequencyData() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() };
  }
  async decodeAudioData() { return { duration: 200 }; }
  async resume() { this.resumes += 1; this.state = 'running'; this.onstatechange?.(); }
  async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
  /** the system, not the listener, takes the sound */
  interrupt() { this.state = 'suspended'; this.onstatechange?.(); }
}

let devices: EventTarget;
let player: SetPlayer;

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (/\/audio/.test(url) ? new Response(new ArrayBuffer(8)) : new Response('{}'))));
  devices = new EventTarget();
  Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
  window.localStorage.clear();
});

afterEach(() => {
  player?.stop();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  vi.unstubAllGlobals();
});

async function playing() {
  player = new SetPlayer(() => songs(null, null), () => {});
  await player.playFrom(1, 40);
  expect(player.state.phase).toBe('playing');
  return FakeAudio.now;
}

describe('GP-0254 physical audio interruptions', () => {
  it('GP-0254-02 works without device APIs and makes no output guarantee', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    player = new SetPlayer(() => songs(null), () => {});
    await player.playFrom(0);
    expect(player.state.phase).toBe('playing');
    expect(player.state.notice).toBe('');
  });

  it('GP-0254-04 says only what is known when the output changes while sound is running', async () => {
    await playing();
    devices.dispatchEvent(new Event('devicechange'));
    expect(player.state.phase).toBe('playing');
    expect(player.state.notice).toBe('Audio output changed. Check your speakers or headphones if you cannot hear the music.');
    expect(player.state.notice).not.toMatch(/connected|disconnected|bluetooth|usb/i);
  });

  it('GP-0254-04 shows paused with a recovery step when the output change stopped the sound', async () => {
    const audio = await playing();
    audio.state = 'suspended';
    devices.dispatchEvent(new Event('devicechange'));
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toBe('Audio output changed. Press play to reconnect the sound.');
  });

  it('GP-0254-01/04 a system interruption is shown as paused, never as still playing', async () => {
    const audio = await playing();
    audio.interrupt();
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toBe('The sound was interrupted. Press play to carry on.');
  });

  it('GP-0254-03 nothing resumes the mix after a deliberate Pause', async () => {
    const audio = await playing();
    await player.togglePause();
    expect(player.state.phase).toBe('paused');
    const resumesAtPause = audio.resumes;
    devices.dispatchEvent(new Event('devicechange'));
    window.dispatchEvent(new Event('pageshow'));
    audio.interrupt();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((done) => setTimeout(done, 30));
    expect(audio.resumes).toBe(resumesAtPause);
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toBe('');
  });

  it('GP-0254-06 keeps the same song and place across sleep and wake, and waits for Play', async () => {
    const audio = await playing();
    audio.currentTime = 30;
    (player as unknown as { tick(): void }).tick();
    const place = { position: player.state.position, songTime: player.state.songTime };
    expect(place.position).toBe(1);
    expect(place.songTime).toBeGreaterThan(60);
    // the machine sleeps: the context stops, time stops, and the page comes back
    audio.state = 'suspended';
    window.dispatchEvent(new Event('pageshow'));
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toBe('The sound stopped while this page was away. Press play to continue.');
    expect(player.state.position).toBe(place.position);
    expect(player.state.songTime).toBeCloseTo(place.songTime, 3);
    const resumes = audio.resumes;
    await new Promise((done) => setTimeout(done, 30));
    expect(audio.resumes).toBe(resumes); // no autoplay on wake
    await player.togglePause();
    expect(player.state.phase).toBe('playing');
    expect(player.state.position).toBe(place.position);
    expect(player.state.songTime).toBeCloseTo(place.songTime, 3);
  });
});
