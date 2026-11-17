/** A tiny fake Web Audio surface for the engine's tests.
 *
 * jsdom has no AudioContext, so these fakes implement exactly what the engine modules consume:
 * nodes that remember their connections, params that record their automation, a clock the test
 * advances by hand, and suspend/resume that fire onstatechange the way player.ts relies on.
 * Nothing renders; tests assert on what was scheduled. A fake "file" of n bytes decodes to n
 * milliseconds of audio by default, so a 5,000 byte ArrayBuffer is a cheap five-second song.
 */

export type ParamEvent = { type: 'set' | 'ramp' | 'cancel'; value?: number; at: number };

export class FakeAudioParam {
  value = 1;
  readonly events: ParamEvent[] = [];
  setValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push({ type: 'set', value, at });
    return this;
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push({ type: 'ramp', value, at });
    return this;
  }
  cancelScheduledValues(at: number) {
    this.events.push({ type: 'cancel', at });
    return this;
  }
}

export class FakeNode {
  readonly connections: unknown[] = [];
  connect(target: unknown) {
    this.connections.push(target);
    return target;
  }
  disconnect() {
    this.connections.length = 0;
  }
}

export class FakeGainNode extends FakeNode {
  readonly gain = new FakeAudioParam();
}

export class FakeAnalyserNode extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getByteFrequencyData(into: Uint8Array) {
    into.fill(0);
  }
}

export class FakeCompressorNode extends FakeNode {
  readonly threshold = new FakeAudioParam();
  readonly knee = new FakeAudioParam();
  readonly ratio = new FakeAudioParam();
  readonly attack = new FakeAudioParam();
  readonly release = new FakeAudioParam();
}

export class FakeBufferSourceNode extends FakeNode {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly started: { when: number; offset?: number; duration?: number }[] = [];
  readonly stopped: number[] = [];
  start(when = 0, offset?: number, duration?: number) {
    this.started.push({ when, offset, duration });
  }
  stop(when = 0) {
    if (this.started.length === 0) throw new Error('cannot stop a source that never started');
    this.stopped.push(when);
  }
  /** Fire the natural end, as the real node would when its audio runs out. */
  end() {
    this.onended?.();
  }
}

export class FakeAudioBuffer {
  readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number) {
    return this.data[channel];
  }
}

/** A buffer this many seconds long. */
export const bufferOfSeconds = (time: number, sampleRate = 44100, channels = 2) =>
  new FakeAudioBuffer(channels, Math.round(time * sampleRate), sampleRate);

class FakeBaseContext {
  currentTime = 0;
  sampleRate = 44100;
  readonly destination = new FakeNode();
  readonly madeSources: FakeBufferSourceNode[] = [];
  readonly madeGains: FakeGainNode[] = [];
  createGain() {
    const made = new FakeGainNode();
    this.madeGains.push(made);
    return made;
  }
  createAnalyser() {
    return new FakeAnalyserNode();
  }
  createDynamicsCompressor() {
    return new FakeCompressorNode();
  }
  createBufferSource() {
    const made = new FakeBufferSourceNode();
    this.madeSources.push(made);
    return made;
  }
  advance(time: number) {
    this.currentTime += time;
  }
}

export class FakeAudioContext extends FakeBaseContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  onstatechange: (() => void) | null = null;
  /** Present only when a test sets it; probe.ts feature-detects it on the instance. The
   * `declare` keeps it out of the emitted class fields, so an unset context really has no
   * such property and a subclass may define it as a getter. */
  declare audioWorklet?: { addModule(url: string | URL): Promise<void> };
  /** Swap in a failing decode to test the per-file error path. */
  decode: (bytes: ArrayBuffer) => Promise<FakeAudioBuffer> = async (bytes) =>
    bufferOfSeconds(bytes.byteLength / 1000, this.sampleRate);
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return this.decode(bytes) as unknown as Promise<AudioBuffer>;
  }
  async suspend() {
    this.setState('suspended');
  }
  async resume() {
    this.setState('running');
  }
  async close() {
    this.setState('closed');
  }
  setState(state: 'running' | 'suspended' | 'closed') {
    if (this.state === state) return;
    this.state = state;
    this.onstatechange?.();
  }
}

export class FakeOfflineAudioContext extends FakeBaseContext {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    sampleRate: number,
    private readonly options: { fill?: (buffer: FakeAudioBuffer) => void } = {},
  ) {
    super();
    this.sampleRate = sampleRate;
  }
  async startRendering(): Promise<AudioBuffer> {
    const made = new FakeAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
    this.options.fill?.(made);
    return made as unknown as AudioBuffer;
  }
}

/** The worklet node shape probe.ts drives; tests emit the report themselves. */
export class FakeWorkletNode extends FakeNode {
  readonly port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (_message: unknown) => {},
    close: () => {},
  };
  emit(data: unknown) {
    this.port.onmessage?.({ data });
  }
}

/** A bare event target for watching documents, media devices and wake locks in tests. */
export class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listen: () => void) {
    let found = this.listeners.get(type);
    if (!found) {
      found = new Set();
      this.listeners.set(type, found);
    }
    found.add(listen);
  }
  removeEventListener(type: string, listen: () => void) {
    this.listeners.get(type)?.delete(listen);
  }
  fire(type: string) {
    for (const listen of [...(this.listeners.get(type) ?? [])]) listen();
  }
}

export class FakeDocument extends FakeEvents {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

/** Manual timers for the scheduler: the test holds the tick and calls it when it chooses. */
export const manualTimers = () => {
  const ticks = new Map<number, () => void>();
  let nextId = 1;
  return {
    set(run: () => void, _everyMs: number) {
      const id = nextId++;
      ticks.set(id, run);
      return id;
    },
    clear(id: number) {
      ticks.delete(id);
    },
    tick() {
      for (const run of [...ticks.values()]) run();
    },
    count() {
      return ticks.size;
    },
  };
};

/** Let queued promise continuations run between assertions. */
export const settle = async (turns = 10) => {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
};
