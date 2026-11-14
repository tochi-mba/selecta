import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudioRuntime } from './BrowserAudioRuntime';
import type { BrowserAudioSourcePort, LocalRecording } from './contracts';

class Param {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
  setTargetAtTime(value: number) { this.value = value; }
  setValueCurveAtTime(value: Float32Array) { this.value = value[value.length - 1]; }
  cancelScheduledValues() {}
}
class Node {
  gain = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  frequency = new Param();
  type = '';
  connect(_target: unknown) { return this; }
  disconnect() {}
}
class Source extends Node {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  starts: Array<[number, number]> = [];
  start(time: number, offset: number) { this.starts.push([time, offset]); }
  stop() { /* avoids firing synchronously in test; browsers fire onended on render */ }
}
class Context {
  static latest: Context;
  currentTime = 12;
  state: AudioContextState = 'suspended';
  destination = new Node();
  onstatechange: (() => void) | null = null;
  audioWorklet = { addModule: vi.fn(async (_url: string) => {}) };
  sources: Source[] = [];
  constructor() { Context.latest = this; }
  createGain() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  async resume() { this.state = 'running'; this.onstatechange?.(); }
  async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
  async close() { this.state = 'closed'; }
}
class WorkletNode extends Node {
  static latest: WorkletNode;
  onprocessorerror: (() => void) | null = null;
  constructor(_context: unknown, _name: string, _options: unknown) {
    super();
    WorkletNode.latest = this;
  }
}
const music = (name: string): LocalRecording => ({
  id: name, title: name, file: new File(['some local bytes'], name + '.wav', { type: 'audio/wav' }),
});
const buffer = (seconds = 30) => ({ duration: seconds, length: seconds * 44100, numberOfChannels: 2 }) as AudioBuffer;
const decoder: BrowserAudioSourcePort = { decode: vi.fn(async () => buffer()) };

describe('BrowserAudioRuntime', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', Context);
    vi.stubGlobal('AudioWorkletNode', WorkletNode);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: vi.fn(async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) => {
        // Hold the lock until engine stop()/pause(), just as browser Web Locks does.
        await callback({});
      }),
    } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('plays two local decks and crossfades without downloading any audio', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const engine = new BrowserAudioRuntime('one', { decoder });
    await engine.setQueue([music('a'), music('b')]);
    await engine.play();
    expect(engine.snapshot()).toMatchObject({ phase: 'playing', title: 'a', ownership: 'exclusive' });
    expect(Context.latest.sources).toHaveLength(1);
    await engine.next();
    expect(Context.latest.sources).toHaveLength(2);
    expect(engine.snapshot()).toMatchObject({ phase: 'playing', index: 1, title: 'b' });
    expect(network).not.toHaveBeenCalled();
    expect(engine.snapshot().soundCheck).toBe('unverified');
    engine.confirmSound(true);
    expect(engine.snapshot().soundCheck).toBe('user_confirmed');
    await engine.stop();
    expect(engine.snapshot().soundCheck).toBe('unverified');
    await engine.dispose();
  });
  it('preserves the click-unlocked context when Studio replaces the local queue', async () => {
    const engine = new BrowserAudioRuntime('studio-gesture', { decoder });
    await engine.activate(); // Synchronously initiated by a user gesture in production.
    const unlocked = Context.latest;
    expect(unlocked.state).toBe('running');
    await engine.setQueue([music('studio-track')]);
    expect(unlocked.state).toBe('running');
    expect(engine.snapshot().phase).toBe('ready');
    await engine.play();
    expect(engine.snapshot()).toMatchObject({ phase: 'playing', title: 'studio-track' });
    expect(unlocked.state).toBe('running');
    await engine.dispose();
  });

  it('replacing a playing queue releases old playback without suspending an activated context', async () => {
    const engine = new BrowserAudioRuntime('studio-replace', { decoder });
    await engine.setQueue([music('first')]);
    await engine.play();
    const context = Context.latest;
    await engine.setQueue([music('replacement')]);
    expect(context.state).toBe('running');
    expect(engine.snapshot()).toMatchObject({
      phase: 'ready', title: 'replacement', ownership: 'none', soundCheck: 'unverified',
    });
    await engine.play();
    expect(engine.snapshot()).toMatchObject({ phase: 'playing', title: 'replacement' });
    await engine.dispose();
  });

  it('supports pause, resume, seek and repeated play idempotently', async () => {
    const engine = new BrowserAudioRuntime('two', { decoder });
    await engine.setQueue([music('a'), music('b')]);
    await engine.play(); await engine.play();
    expect(Context.latest.sources).toHaveLength(1);
    Context.latest.currentTime += 8;
    await engine.pause();
    expect(engine.snapshot()).toMatchObject({ phase: 'paused', ownership: 'none' });
    // The scheduled source starts 20ms after the WebAudio clock: elapsed
    // audio is 7.98s when the mock context advances exactly eight seconds.
    expect(engine.snapshot().position).toBeCloseTo(7.98, 2);
    await engine.seek(21);
    expect(engine.snapshot().position).toBe(21);
    await engine.play();
    expect(Context.latest.sources.at(-1)?.starts[0]?.[1]).toBe(21);
    await engine.previous();
    expect(engine.snapshot().index).toBe(0);
    await engine.dispose();
  });
  it('restarts the preceding track after a crossfade rather than leaving the speaker silent', async () => {
    const engine = new BrowserAudioRuntime('previous-regression', { decoder });
    await engine.setQueue([music('first'), music('second')]);
    await engine.play();
    await engine.next();
    expect(engine.snapshot().index).toBe(1);
    const sourcesBefore = Context.latest.sources.length;
    await engine.previous();
    expect(engine.snapshot()).toMatchObject({ phase: 'playing', index: 0, title: 'first' });
    expect(Context.latest.sources).toHaveLength(sourcesBefore + 1);
    expect(Context.latest.sources.at(-1)?.starts).toHaveLength(1);
    await engine.dispose();
  });
  it('preserves an active track when a later local recording fails decode', async () => {
    const badDecoder: BrowserAudioSourcePort = {
      decode: vi.fn(async (file) => {
        if (file.name.startsWith('bad')) throw new Error('unsupported');
        return buffer();
      }),
    };
    const engine = new BrowserAudioRuntime('three', { decoder: badDecoder });
    await engine.setQueue([music('good'), music('bad')]);
    await engine.play(); await engine.next();
    expect(engine.snapshot().phase).toBe('playing');
    expect(engine.snapshot().title).toBe('good');
    expect(engine.snapshot().error).toContain('could not decode');
    await engine.dispose();
  });
  it('refuses duplicate-tab ownership without starting a source', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_key: string, _options: unknown, callback: (lock: null) => Promise<void>) => callback(null),
    } });
    const engine = new BrowserAudioRuntime('busy', { decoder });
    await engine.setQueue([music('a')]); await engine.play();
    expect(engine.snapshot()).toMatchObject({ phase: 'error', ownership: 'none' });
    expect(Context.latest.sources).toHaveLength(0);
    await engine.dispose();
  });
  it('does not mistake a suspended browser context for verified sound', async () => {
    const engine = new BrowserAudioRuntime('interruption', { decoder });
    await engine.setQueue([music('a')]); await engine.play();
    engine.confirmSound(true);
    Context.latest.state = 'suspended';
    Context.latest.onstatechange?.();
    await Promise.resolve();
    expect(engine.snapshot().phase).toBe('interrupted');
    expect(engine.snapshot().soundCheck).toBe('unverified');
    await engine.dispose();
  });
  it('discards a failed worklet graph instead of resuming permanently silent audio', async () => {
    const engine = new BrowserAudioRuntime('worklet-crash', { decoder });
    await engine.setQueue([music('a')]);
    await engine.play();
    const failedContext = Context.latest;
    WorkletNode.latest.onprocessorerror?.();
    expect(engine.snapshot()).toMatchObject({
      phase: 'interrupted', ownership: 'none', soundCheck: 'unverified',
    });
    await engine.play();
    expect(Context.latest).not.toBe(failedContext);
    expect(engine.snapshot()).toMatchObject({ phase: 'playing', ownership: 'exclusive' });
    await engine.dispose();
  });
  it('reports AudioWorklet absence rather than pretending a MediaElement is a mixer', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined);
    const engine = new BrowserAudioRuntime('unsupported', { decoder });
    await engine.setQueue([music('a')]); await engine.play();
    expect(engine.snapshot().phase).toBe('error');
    expect(engine.snapshot().error).toContain('AudioWorklet');
    await engine.dispose();
  });
});
