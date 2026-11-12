import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { songs } from './test/backend';

/** GP-0254-05: unplugging and plugging back an output, as the browser sees it.
 * To a page, a USB interface, wired headphones and a Bluetooth headset all look the same: a
 * devicechange event, and sometimes an audio context the system has stopped. These cases replay
 * that sequence for each kind of output; the real hardware matrix still needs a person. */

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

const settle = () => new Promise((done) => setTimeout(done, 30));

function place() {
  (player as unknown as { tick(): void }).tick();
  return { position: player.state.position, songTime: player.state.songTime };
}

describe('GP-0254-05 output unplugged and plugged back', () => {
  for (const output of ['USB interface', 'wired headphones', 'Bluetooth headset']) {
    it(`${output}: unplugging stops honestly, plugging back plays nothing, Play carries on from the same place`, async () => {
      player = new SetPlayer(() => songs(null, null), () => {});
      await player.playFrom(1, 40);
      const audio = FakeAudio.now;
      audio.currentTime = 12;
      const before = place();

      // unplugged: the system stops the sound and the device list changes
      audio.state = 'suspended';
      devices.dispatchEvent(new Event('devicechange'));
      expect(player.state.phase).toBe('paused');
      expect(player.state.notice).toBe('Audio output changed. Press play to reconnect the sound.');
      expect(player.state.notice).not.toMatch(/usb|bluetooth|headphones? (are|is) (connected|disconnected)/i);
      expect(player.state.position).toBe(before.position);
      expect(player.state.songTime).toBeCloseTo(before.songTime, 3);

      // plugged back: another devicechange, and nothing starts by itself
      const resumes = audio.resumes;
      devices.dispatchEvent(new Event('devicechange'));
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(audio.resumes).toBe(resumes);
      expect(player.state.phase).toBe('paused');
      expect(player.state.position).toBe(before.position);

      // the listener presses Play
      await player.togglePause();
      expect(player.state.phase).toBe('playing');
      expect(player.state.position).toBe(before.position);
      expect(player.state.songTime).toBeCloseTo(before.songTime, 3);
    });
  }

  it('an output that changes while sound keeps running stays playing and claims nothing about audibility', async () => {
    player = new SetPlayer(() => songs(null, null), () => {});
    await player.playFrom(1, 40);
    for (let swap = 0; swap < 3; swap += 1) {
      devices.dispatchEvent(new Event('devicechange'));
      expect(player.state.phase).toBe('playing');
      expect(player.state.notice).toBe('Audio output changed. Check your speakers or headphones if you cannot hear the music.');
    }
  });

  it('after a deliberate Pause, unplugging and plugging back leaves it paused with no notice', async () => {
    player = new SetPlayer(() => songs(null, null), () => {});
    await player.playFrom(1, 40);
    const audio = FakeAudio.now;
    await player.togglePause();
    const resumes = audio.resumes;
    audio.state = 'suspended';
    devices.dispatchEvent(new Event('devicechange'));
    devices.dispatchEvent(new Event('devicechange'));
    await settle();
    expect(audio.resumes).toBe(resumes);
    expect(player.state.phase).toBe('paused');
    expect(player.state.notice).toBe('');
  });
});
