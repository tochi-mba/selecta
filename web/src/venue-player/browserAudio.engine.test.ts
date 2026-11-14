import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserVenueAudio, type LocalRecording } from './browserAudio';

const started: string[] = [];
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
  setTargetAtTime(): void {}
}
class FakeNode {
  connect(): void {}
  disconnect(): void {}
}
class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start(): void { started.push('buffer'); }
  stop(): void { this.onended?.(); }
}
class FakeOscillator extends FakeNode {
  type: OscillatorType = 'sine';
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  start(): void { started.push('tone'); }
  stop(): void { this.onended?.(); }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeContext {
  state: AudioContextState = 'suspended';
  currentTime = 1;
  destination = new FakeNode();
  createGain(): GainNode { return new FakeGain() as unknown as GainNode; }
  createBufferSource(): AudioBufferSourceNode { return new FakeSource() as unknown as AudioBufferSourceNode; }
  createOscillator(): OscillatorNode { return new FakeOscillator() as unknown as OscillatorNode; }
  async decodeAudioData(): Promise<AudioBuffer> {
    return { duration: 60, length: 60 * 44_100, numberOfChannels: 2 } as AudioBuffer;
  }
  async resume(): Promise<void> { this.state = 'running'; }
  async suspend(): Promise<void> { this.state = 'suspended'; }
  async close(): Promise<void> { this.state = 'closed'; }
}
const makeRec = (id: string): LocalRecording => ({
  id, title: id, artist: 'Test', revision: 'v1', permitted: true,
  file: Object.assign(new File(['test'], id + '.wav'), { arrayBuffer: async () => new ArrayBuffer(4) }),
});
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_key: string, _options: unknown,
      callback: (lock: object | null) => Promise<void>) => {
      await callback({});
    },
  } });
});
afterEach(() => {
  vi.unstubAllGlobals(); started.length = 0;
  delete (navigator as Navigator & { locks?: LockManager }).locks;
});

describe('BR64-08 device-local WebAudio execution (simulated nodes, never hardware proof)', () => {
  it('decodes locally granted files and starts an actual Web Audio source', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a'), makeRec('b')]);
      expect(await audio.unlock()).toBe(true);
      await audio.prepare('a');
      await audio.start('a', 1);
      expect(started).toContain('buffer');
      expect(audio.playing()).toBe(false); // an unlock + audio node start is not physical evidence
      expect(audio.snapshot().output).toBe('unverified');
      await audio.soundCheck();
      expect(started).toContain('tone');
      expect(audio.confirmHeard()).toBe(true);
      expect(audio.playing()).toBe(true); // only operator testimony, NOT instrumented hardware
      await audio.transition('b', 0.5);
      expect(started.filter((v) => v === 'buffer')).toHaveLength(2);
      expect(audio.playing()).toBe(false); // confirmation invalidated on transition
    } finally { await audio.dispose(); }
  });
  it('refuses unprepared, stale-generation or unauthorised recordings', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a')]);
      await audio.unlock();
      await expect(audio.start('unknown', 1)).rejects.toThrow(/authorised/);
      await audio.start('a', 5);
      await expect(audio.start('a', 4)).rejects.toThrow(/generation/);
    } finally { await audio.dispose(); }
  });
  it('starts another prepared recording without stopping the audible venue or losing ownership', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a'), makeRec('b')]);
      await audio.unlock();
      await audio.start('a', 1);
      await expect(audio.start('missing', 2)).rejects.toThrow(/authorised/);
      expect(audio.snapshot()).toMatchObject({ currentId: 'a', phase: 'playing', generation: 1 });
      await audio.start('b', 2);
      // FakeSource.stop() invokes onended synchronously: the outgoing callback
      // must not clear the replacement or release its browser ownership.
      expect(audio.snapshot()).toMatchObject({ currentId: 'b', phase: 'playing', generation: 2 });
      expect(started.filter((item) => item === 'buffer')).toHaveLength(2);
    } finally { await audio.dispose(); }
  });
  it('refuses an already-owned output rather than layering another physical player', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_key: string, _options: unknown,
        callback: (lock: object | null) => Promise<void>) => callback(null),
    } });
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a')]);
      await audio.unlock();
      await audio.prepare('a');
      await expect(audio.start('a', 1)).rejects.toThrow(/owns this output/);
      expect(started).not.toContain('buffer');
    } finally { await audio.dispose(); }
  });
  it('does not promise wake lock, hidden iPad play or reboot recovery', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new BrowserVenueAudio();
    try {
      await audio.unlock();
      expect(audio.snapshot().wakeLockHeld).toBe(false);
      expect(audio.snapshot().phase).toBe('ready');
      expect(audio.playing()).toBe(false);
    } finally { await audio.dispose(); }
  });
});
