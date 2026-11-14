import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production AudioWorklet DSP', () => {
  it('mixes synthetic stereo and mono inputs without irreversible pre-limiter clipping', () => {
    let Processor: (new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }) | null = null;
    const source = readFileSync(new URL('./mixer.worklet.js', import.meta.url), 'utf8');
    // Execute the same processor source with a minimal Worklet global, not a reimplementation.
    new Function('AudioWorkletProcessor', 'registerProcessor', source)(
      class {},
      (name: string, ctor: typeof Processor) => {
        expect(name).toBe('selecta-browser-mixer-v1'); Processor = ctor;
      },
    );
    expect(Processor).toBeTruthy();
    const processor = new (Processor!)();
    const output = [[new Float32Array(128), new Float32Array(128)]];
    const input = [
      [Float32Array.from({ length: 128 }, () => 0.7), Float32Array.from({ length: 128 }, () => 0.2)],
      [Float32Array.from({ length: 128 }, () => 0.6)],
    ];
    expect(processor.process(input, output)).toBe(true);
    // The downstream compressor owns peak control; clipping to 1 here is distortion.
    expect(output[0][0][0]).toBeCloseTo(1.3);
    expect(output[0][1][0]).toBeCloseTo(0.8);
    const silence = [[new Float32Array(128), new Float32Array(128)]];
    expect(processor.process([[], []], silence)).toBe(true);
    expect(silence[0][0][0]).toBe(0);
  });
});
