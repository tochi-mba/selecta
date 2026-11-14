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
  stop(_when?: number): void { this.onended?.(); }
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
  it('rejects a delayed transition after Stop without starting a hidden second source', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new BrowserVenueAudio();
    let releaseDecode!: (buffer: AudioBuffer) => void;
    try {
      audio.importLocal([makeRec('a'), makeRec('b')]);
      await audio.unlock();
      await audio.start('a', 1);
      const decoder = vi.spyOn(FakeContext.prototype, 'decodeAudioData').mockImplementation(
        () => new Promise<AudioBuffer>((resolve) => { releaseDecode = resolve; }),
      );
      const pending = audio.transition('b', 2);
      const rejected = expect(pending).rejects.toThrow('Transition cancelled');
      await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(1));
      await audio.stop();
      releaseDecode({ duration: 60, length: 60 * 44_100, numberOfChannels: 2 } as AudioBuffer);
      await rejected;
      expect(audio.snapshot().phase).toBe('stopped');
      expect(started.filter((entry) => entry === 'buffer')).toHaveLength(1);
    } finally { await audio.dispose(); vi.restoreAllMocks(); }
  });

  it('does not replace an active source with another File using the same revision string', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a')]);
      await audio.unlock();
      await audio.start('a', 1);
      expect(() => audio.bindLocal(makeRec('a'))).toThrow('currently audible');
      expect(audio.snapshot().currentId).toBe('a');
    } finally { await audio.dispose(); }
  });

  it('does not start audio when Stop cancels a pending browser speaker lock', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    let grant!: () => void;
    const pendingLock = new Promise<void>((resolve) => { grant = resolve; });
    const request = vi.fn(async (_key: string, _options: unknown,
      callback: (lock: object | null) => Promise<void>) => {
      await pendingLock;
      await callback({});
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a')]);
      await audio.unlock();
      await audio.prepare('a');
      const start = audio.start('a', 1);
      const rejection = expect(start).rejects.toThrow('superseded');
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await audio.stop();
      grant();
      await rejection;
      expect(started).not.toContain('buffer');
      expect(audio.snapshot().phase).toBe('stopped');
    } finally { grant(); await audio.dispose(); }
  });

  it('Stop also silences an active sound-check tone', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const stop = vi.spyOn(FakeOscillator.prototype, 'stop');
    const audio = new BrowserVenueAudio();
    try {
      await audio.unlock();
      await audio.soundCheck();
      expect(started).toContain('tone');
      const before = stop.mock.calls.length;
      await audio.stop();
      expect(stop.mock.calls.length).toBeGreaterThan(before);
      expect(audio.confirmHeard()).toBe(false);
    } finally { await audio.dispose(); stop.mockRestore(); }
  });
  it('does not restore Ready after Stop while AudioContext unlock is pending', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    let unlock!: () => void;
    const pending = new Promise<void>((resolve) => { unlock = resolve; });
    const resume = vi.spyOn(FakeContext.prototype, 'resume').mockImplementation(async function (this: FakeContext) {
      await pending;
      this.state = 'running';
    });
    const audio = new BrowserVenueAudio();
    try {
      const unlocking = audio.unlock();
      await audio.stop();
      unlock();
      expect(await unlocking).toBe(false);
      expect(audio.snapshot().phase).toBe('stopped');
    } finally { unlock(); await audio.dispose(); resume.mockRestore(); }
  });

  it('releases a Wake Lock granted after playback was stopped', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    let grant!: () => void;
    const wait = new Promise<void>((resolve) => { grant = resolve; });
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => {
      await wait;
      return { released: false, release };
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true, value: { request },
    });
    const audio = new BrowserVenueAudio();
    try {
      const unlocking = audio.unlock();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await audio.stop();
      grant();
      expect(await unlocking).toBe(false);
      expect(release).toHaveBeenCalledTimes(1);
      expect(audio.snapshot().wakeLockHeld).toBe(false);
      expect(audio.snapshot().phase).toBe('stopped');
    } finally {
      grant();
      await audio.dispose();
      delete (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
    }
  });

  it('does not play a delayed sound-check tone after Stop cancels ownership', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    let grant!: () => void;
    const wait = new Promise<void>((resolve) => { grant = resolve; });
    const request = vi.fn(async (_key: string, _options: unknown,
      callback: (lock: object | null) => Promise<void>) => {
      await wait;
      await callback({});
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    const audio = new BrowserVenueAudio();
    try {
      await audio.unlock();
      const checking = audio.soundCheck();
      const rejection = expect(checking).rejects.toThrow('cancelled');
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await audio.stop();
      grant();
      await rejection;
      expect(started).not.toContain('tone');
      expect(audio.snapshot().phase).toBe('stopped');
    } finally { grant(); await audio.dispose(); }
  });
  it('Stop also stops the outgoing track during an unfinished crossfade', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const issued: FakeSource[] = [];
    const create = vi.spyOn(FakeContext.prototype, 'createBufferSource').mockImplementation(() => {
      const node = new FakeSource();
      issued.push(node);
      return node as unknown as AudioBufferSourceNode;
    });
    const immediate: FakeSource[] = [];
    const stop = vi.spyOn(FakeSource.prototype, 'stop').mockImplementation(function (this: FakeSource, when?: number) {
      // A future stop does not call onended until the real audio clock reaches it.
      if (when !== undefined) return;
      immediate.push(this);
      this.onended?.();
    });
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a'), makeRec('b')]);
      await audio.unlock();
      await audio.start('a', 1);
      await audio.transition('b', 2);
      expect(issued).toHaveLength(2);
      expect(immediate).toHaveLength(0);
      await audio.stop();
      expect(immediate).toContain(issued[0]);
      expect(immediate).toContain(issued[1]);
      expect(audio.snapshot().phase).toBe('stopped');
    } finally { await audio.dispose(); create.mockRestore(); stop.mockRestore(); }
  });

  it('a rapid second Skip silences the old outgoing deck instead of creating a triple overlap', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const issued: FakeSource[] = [];
    const create = vi.spyOn(FakeContext.prototype, 'createBufferSource').mockImplementation(() => {
      const node = new FakeSource();
      issued.push(node);
      return node as unknown as AudioBufferSourceNode;
    });
    const immediate: FakeSource[] = [];
    const stop = vi.spyOn(FakeSource.prototype, 'stop').mockImplementation(function (this: FakeSource, when?: number) {
      if (when !== undefined) return;
      immediate.push(this);
      this.onended?.();
    });
    const audio = new BrowserVenueAudio();
    try {
      audio.importLocal([makeRec('a'), makeRec('b'), makeRec('c')]);
      await audio.unlock();
      await audio.start('a', 1);
      await audio.transition('b', 2);
      await audio.transition('c', 2);
      expect(issued).toHaveLength(3);
      expect(immediate).toContain(issued[0]);
      expect(audio.snapshot()).toMatchObject({ currentId: 'c', phase: 'playing' });
    } finally { await audio.dispose(); create.mockRestore(); stop.mockRestore(); }
  });
});
