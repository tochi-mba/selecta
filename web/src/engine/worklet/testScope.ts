import { vi } from 'vitest';

/** Runs a processor module's real source text against a fake AudioWorklet global scope, so the
 * exact code the browser loads is what the tests drive. Call `vi.unstubAllGlobals()` after. */

export class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  send(data: unknown) {
    this.onmessage?.({ data });
  }
}

export type FakeProcessorInstance = {
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters?: Record<string, Float32Array>): boolean;
};
export type FakeProcessorClass = new (options?: unknown) => FakeProcessorInstance;

export function loadProcessorSource(source: string, sampleRate = 44100): {
  registered: Map<string, FakeProcessorClass>;
  setFrame(frame: number): void;
} {
  const registered = new Map<string, FakeProcessorClass>();
  class AudioWorkletProcessor {
    port = new FakePort();
  }
  vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessor);
  vi.stubGlobal('registerProcessor', (name: string, made: FakeProcessorClass) => registered.set(name, made));
  vi.stubGlobal('sampleRate', sampleRate);
  vi.stubGlobal('currentFrame', 0);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(source)();
  return {
    registered,
    setFrame: (frame) => vi.stubGlobal('currentFrame', frame),
  };
}
