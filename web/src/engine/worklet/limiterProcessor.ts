import { processorSource, WorkletScope } from './scope';

/** The real-time true-peak limiter processor (ADR-0459 Tier 1, BF-0459-02).
 *
 * The same design as the offline reference in `web/src/dsp/limiter.ts::process`, streamed:
 *  1. a 4-phase interpolated true-peak sidechain (the `interpolatorPhases` taps from
 *     dsp/loudness.ts, passed in), never below the sample's own magnitude, max over channels;
 *  2. needed gain = min(1, ceiling / peak);
 *  3. a centred sliding minimum of `windowSamples` (monotonic deque, O(1) amortised);
 *  4. a centred moving average of the same window over the held gain;
 *  5. gain = min(average, needed); output = delayed input * gain.
 * Centred windows need the future, so the output is the input delayed by `delaySamples`
 * (window - 1 plus the interpolator's lookahead). In steady state the output matches the offline
 * process() sample for sample (up to float rounding) and can never exceed the ceiling, because
 * the final gain is never above the needed gain for that sample.
 *
 * The numbers come from `limiterCoefficients` on the main thread (engine/limiter.ts); this
 * module only applies them. `defineLimiterProcessor` runs inside the worklet scope only.
 */

export const LIMITER_PROCESSOR = 'selecta-limiter';

export type LimiterProcessorOptions = {
  ceilingLinear: number;
  /** Odd window length, from limiterCoefficients. */
  windowSamples: number;
  /** The true-peak interpolator phases, from interpolatorPhases (plain arrays for cloning). */
  phases: number[][];
};

/** What the processor answers to a { type: 'stats' } message: processing evidence only. */
export type LimiterStats = {
  type: 'limiter-stats';
  blocks: number;
  frames: number;
  frame: number;
  sampleRate: number;
  peakIn: number;
  peakOut: number;
  delaySamples: number;
};

/** Samples the interpolator reads ahead of the sample it estimates (taps / 2 - 1). */
export function truePeakLookahead(phases: number[][]): number {
  const taps = phases[0]?.length ?? 0;
  return taps > 0 ? taps / 2 - 1 : 0;
}

/** The fixed output delay of the streamed limiter, in samples. */
export function limiterDelaySamples(options: Pick<LimiterProcessorOptions, 'windowSamples' | 'phases'>): number {
  return options.windowSamples - 1 + truePeakLookahead(options.phases);
}

function defineLimiterProcessor(name: string): void {
  const scope = globalThis as unknown as WorkletScope;

  type Options = { processorOptions?: LimiterProcessorOptions };

  // No class fields: every transpiler (Vite, Vitest, Playwright's Babel) emits this the same
  // way, so the source text the browser gets is plain class syntax.
  type State = {
    ceiling: number;
    window: number;
    half: number;
    phases: Float64Array[];
    taps: number;
    ahead: number;
    delay: number;
    size: number;
    input: Float32Array[];
    needed: Float32Array;
    held: Float32Array;
    deque: Float64Array;
    head: number;
    tail: number;
    sum: number;
    n: number;
    blocks: number;
    peakIn: number;
    peakOut: number;
    port: MessagePort;
  };

  const ring = (index: number, size: number): number => {
    const at = index % size;
    return at < 0 ? at + size : at;
  };

  class LimiterProcessor extends scope.AudioWorkletProcessor {
    constructor(options?: Options) {
      super(options);
      const made = options?.processorOptions;
      if (!made || !(made.windowSamples >= 3) || !(made.ceilingLinear > 0) || !made.phases?.length) {
        throw new Error('selecta-limiter needs ceilingLinear, windowSamples and phases');
      }
      const self = this as unknown as State;
      self.ceiling = made.ceilingLinear;
      self.window = made.windowSamples | 1;
      self.half = (self.window - 1) / 2;
      self.phases = made.phases.map((taps) => Float64Array.from(taps));
      self.taps = self.phases[0].length;
      self.ahead = self.taps / 2 - 1;
      self.delay = self.window - 1 + self.ahead;
      // The input ring reaches back to the delayed output sample and the oldest FIR tap.
      self.size = self.delay + self.taps + 2;
      self.input = [];
      // Before the stream starts, history is silence: needed and held gains of 1.
      self.needed = new Float32Array(self.window + 1).fill(1);
      self.held = new Float32Array(self.window + 2).fill(1);
      self.deque = new Float64Array(self.window + 2);
      self.head = 0;
      self.tail = 0;
      self.sum = self.window;
      self.n = 0;
      self.blocks = 0;
      self.peakIn = 0;
      self.peakOut = 0;
      self.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string } | null;
        if (!data || data.type !== 'stats') return;
        self.port.postMessage({
          type: 'limiter-stats',
          blocks: self.blocks,
          frames: self.n,
          frame: scope.currentFrame,
          sampleRate: scope.sampleRate,
          peakIn: self.peakIn,
          peakOut: self.peakOut,
          delaySamples: self.delay,
        });
      };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const self = this as unknown as State;
      const output = outputs[0];
      if (!output || output.length === 0) return true;
      const source = inputs[0] ?? [];
      const channels = output.length;
      const frames = output[0].length;
      while (self.input.length < channels) self.input.push(new Float32Array(self.size));
      const window = self.window;
      const half = self.half;
      const neededSize = self.needed.length;
      const heldSize = self.held.length;
      const dequeSize = self.deque.length;

      for (let frame = 0; frame < frames; frame += 1) {
        const n = self.n;
        // 1. take the newest input sample on every channel (a missing channel copies channel 0,
        //    no input at all is silence).
        let peak = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const lane = source[channel] ?? source[0];
          const value = lane ? lane[frame] : 0;
          if (Math.abs(value) > self.peakIn) self.peakIn = Math.abs(value);
          self.input[channel][ring(n, self.size)] = value;
        }
        // 2. the true-peak sidechain for p = n - ahead, which now has all its taps.
        const p = n - self.ahead;
        for (let channel = 0; channel < channels; channel += 1) {
          const lane = self.input[channel];
          let channelPeak = Math.abs(lane[ring(p, self.size)]);
          for (let phase = 0; phase < self.phases.length; phase += 1) {
            const taps = self.phases[phase];
            let value = 0;
            for (let tap = 0; tap < self.taps; tap += 1) {
              value += taps[tap] * lane[ring(p + self.ahead - tap, self.size)];
            }
            const size = Math.abs(value);
            if (size > channelPeak) channelPeak = size;
          }
          if (channelPeak > peak) peak = channelPeak;
        }
        const gainNeeded = self.ceiling / Math.max(peak, 1e-9);
        const neededNow = Math.fround(gainNeeded < 1 ? gainNeeded : 1);
        self.needed[ring(p, neededSize)] = neededNow;

        // 3. centred sliding minimum: held[m] for m = p - half covers needed[p - 2 half .. p].
        while (self.tail > self.head && self.needed[ring(self.deque[ring(self.tail - 1, dequeSize)], neededSize)] >= neededNow) {
          self.tail -= 1;
        }
        self.deque[ring(self.tail, dequeSize)] = p;
        self.tail += 1;
        while (self.deque[ring(self.head, dequeSize)] < p - window + 1) self.head += 1;
        const m = p - half;
        const heldNow = self.needed[ring(self.deque[ring(self.head, dequeSize)], neededSize)];

        // 4. centred moving average: smooth[k] for k = m - half over held[k - half .. k + half].
        const leaving = self.held[ring(m - window, heldSize)];
        self.held[ring(m, heldSize)] = heldNow;
        self.sum += heldNow - leaving;
        const k = m - half;
        const smooth = self.sum / window;

        // 5. the final gain on the delayed sample k.
        const neededAtK = self.needed[ring(k, neededSize)];
        const gain = smooth < neededAtK ? smooth : neededAtK;
        for (let channel = 0; channel < channels; channel += 1) {
          const out = self.input[channel][ring(k, self.size)] * gain;
          output[channel][frame] = out;
          if (Math.abs(out) > self.peakOut) self.peakOut = Math.abs(out);
        }
        self.n = n + 1;
      }
      self.blocks += 1;
      return true;
    }
  }

  scope.registerProcessor(name, LimiterProcessor);
}

export const LIMITER_PROCESSOR_SOURCE = processorSource(defineLimiterProcessor, LIMITER_PROCESSOR);
