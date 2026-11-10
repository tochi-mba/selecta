import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from './player';
import { seam, songs } from './test/backend';
import type { MixItem } from './api';

// T0167: a song removed from the mix while it is the one playing.
class FakeAudio {
  currentTime = 0;
  destination = {};
  state: AudioContextState = 'suspended';
  sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 256, smoothingTimeConstant: 0, connect() {}, getByteFrequencyData(data: Uint8Array) { data.fill(96); } };
  }
  createBufferSource() {
    const source = { buffer: null, connect() {}, disconnect() {}, start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() { return { duration: 100 }; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

const tick = (player: SetPlayer) => (player as unknown as { tick(): void }).tick();
const playingSong = (player: SetPlayer) => (player as unknown as { current: { songId: number } | null }).current?.songId;
const settle = () => new Promise((done) => setTimeout(done, 20));
const without = (mix: MixItem[], position: number): MixItem[] =>
  mix.filter((item) => item.position !== position).map((item, index) => ({ ...item, position: index }));

describe('T0167 removing the song that is playing', () => {
  let player: SetPlayer;
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudio);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (/songs\/\d+\/audio/.test(url) ? new Response(new ArrayBuffer(8), { status: 200 }) : new Response('{}', { status: 200 }))));
    window.localStorage.clear();
  });
  afterEach(() => {
    player?.stop();
    vi.unstubAllGlobals();
  });

  it('keeps it sounding, with no restart and no silence', async () => {
    const full = songs(seam('none', 'a'), seam('none', 'b'), seam('none', 'c'));
    let mix = full;
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(1, 20);
    const audio = (player as unknown as { context: FakeAudio }).context;
    const started = audio.sources.length;
    mix = without(full, 1);
    tick(player);
    await settle();
    expect(player.state.phase).toBe('playing');
    expect(playingSong(player)).toBe(2);
    expect(audio.sources.length).toBe(started);
    expect(audio.sources.every((source) => source.stop.mock.calls.length === 0)).toBe(true);
  });

  it('Next goes on to the song that followed it, not back to the start of the mix', async () => {
    const full = songs(seam('none', 'a'), seam('none', 'b'), seam('none', 'c'));
    let mix = full;
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(1, 20);
    mix = without(full, 1);
    await player.next();
    expect(playingSong(player)).toBe(3);
    expect(player.state.position).toBe(1);
  });

  it('when it ends, the song that followed it fades in, none skipped', async () => {
    const full = songs(seam('none', 'a'), seam('none', 'b'), seam('none', 'c'));
    let mix = full;
    player = new SetPlayer(() => mix, () => {});
    await player.playFrom(1, 99);
    mix = without(full, 1);
    console.log('DBG before', JSON.stringify(player.state), (player as any).ending, (player as any).songTime());
    tick(player);
    await settle();
    console.log('DBG after', JSON.stringify(player.state), (player as any).ending);
    expect(playingSong(player)).toBe(3);
  });
});
