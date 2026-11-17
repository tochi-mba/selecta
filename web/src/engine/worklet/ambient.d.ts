/** Ambient declarations for the AudioWorklet global scope (ADR-0457).
 *
 * TypeScript's DOM lib describes the main thread, where AudioWorkletNode lives, but not the
 * worklet scope where processors run. These declarations cover exactly what the engine's
 * processors use. They are global for the whole web compile, so keep them minimal: only names
 * that really exist in the worklet scope, nothing invented.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>,
    ): boolean;
  },
): void;

/** The context's sample rate, a global inside the worklet scope. */
declare const sampleRate: number;
/** The frame counter at the start of the current render quantum. */
declare const currentFrame: number;
/** The context time at the start of the current render quantum. */
declare const currentTime: number;
