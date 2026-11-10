import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { songs } from '../test/backend';

/** UF-0373-08: mute, a lost output device and a system interruption each leave a visible, recoverable
 * state. The player never claims it is still playing, and never resumes by itself. */

class FakeAudio {
  static now: FakeAudio;
  currentTime = 0;
  destination = {};
  state: AudioContextState = 'suspended';
  onstatechange: (() => void) | null = null;
  gains: { gain: { value: number } }[] = [];
  constructor() { FakeAudio.now = this; }
  createGain() {
    const node = { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} };
    this.gains.push(node);
    return node;
  }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 256, smoothingTimeConstant: 0, connect() {}, getByteFrequencyData(data: Uint8Array) { data.fill(0); } };
  }
  createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() }; }
  async decodeAudioData() { return { duration: 100 }; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

let devices: EventTarget;
let player: SetPlayer;

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudio);
  devices = new EventTarget();
  Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (/songs\/\d+\/audio/.test(url) ? new Response(new ArrayBuffer(8)) : new Response('{}'))));
});

afterEach(() => {
  player.stop();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.unstubAllGlobals();
});

describe('output interruptions', () => {
  it('a lost output device pauses with a reason and waits for the listener', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    expect(player.state.phase).toBe('playing');
    FakeAudio.now.state = 'suspended';
    devices.dispatchEvent(new Event('devicechange'));
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toMatch(/Audio output changed\. Press play/);
    expect(FakeAudio.now.state).toBe('suspended');
  });

  it('a changed device that still plays only says so, and keeps playing', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    devices.dispatchEvent(new Event('devicechange'));
    expect(player.state.phase).toBe('playing');
    expect(player.state.notice).toMatch(/Check your speakers or headphones/);
  });

  it('the system taking the sound away is a visible pause, not a pretend play', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    FakeAudio.now.state = 'interrupted' as AudioContextState;
    FakeAudio.now.onstatechange?.();
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toMatch(/interrupted\. Press play/);
  });

  it('a device change while paused changes nothing', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    await player.togglePause();
    const before = player.state;
    devices.dispatchEvent(new Event('devicechange'));
    expect(player.state).toBe(before);
  });

  it('mute is a state the transport shows, and silences only the output', async () => {
    player = new SetPlayer(() => songs(), () => {});
    await player.playFrom(0);
    player.toggleMute();
    expect(player.state.muted).toBe(true);
    expect(player.state.phase).toBe('playing');
    player.toggleMute();
    expect(player.state.muted).toBe(false);
  });
});
