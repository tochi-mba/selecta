/** The single place that knows the converted model's tensor shapes.
 *
 * Contract set by tools/stems_onnx_export.py (change both together):
 *   input  'mix'    float32 [1, 2, S]     one stereo segment, S = STEM_SEGMENT_SAMPLES (7.8 s at
 *                                          44.1 kHz = 343980), already normalised by the caller
 *   output 'stems'  float32 [1, 4, 2, S]  sources in STEM_MODEL.stems order
 *                                          (drums, bass, other, vocals), each stereo
 * Batch is always 1. Anything else from the session is refused rather than reinterpreted.
 */

import { STEM_MODEL } from './model';

export const STEM_INPUT_NAME = 'mix';
export const STEM_OUTPUT_NAME = 'stems';

/** The subset of onnxruntime-web this code touches, so tests can stand in for it. */
export interface OrtTensorLike {
  dims: readonly number[];
  data: unknown;
}

export interface OrtLike {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensorLike;
  InferenceSession: {
    create: (model: Uint8Array, options?: Record<string, unknown>) => Promise<OrtSessionLike>;
  };
  env: { wasm: { numThreads?: number; proxy?: boolean } };
}

export interface OrtSessionLike {
  run: (feeds: Record<string, OrtTensorLike>) => Promise<Record<string, OrtTensorLike>>;
  release?: () => Promise<void>;
}

/** Build the session feeds for one stereo segment of exactly `segmentSamples`. */
export function htdemucsFeeds(ort: OrtLike, left: Float32Array, right: Float32Array): Record<string, OrtTensorLike> {
  const samples = left.length;
  if (right.length !== samples) throw new Error('Both channels of a segment must be the same length.');
  const mix = new Float32Array(2 * samples);
  mix.set(left, 0);
  mix.set(right, samples);
  return { [STEM_INPUT_NAME]: new ort.Tensor('float32', mix, [1, 2, samples]) };
}

/** Split the session output into stem-major planar channels: [drums L, drums R, bass L, ...]. */
export function htdemucsOutputs(outputs: Record<string, OrtTensorLike>, samples: number): Float32Array[] {
  const tensor = outputs[STEM_OUTPUT_NAME];
  const stems = STEM_MODEL.stems.length;
  const expected = [1, stems, 2, samples];
  if (!tensor || tensor.dims.length !== 4 || tensor.dims.some((size, axis) => size !== expected[axis])) {
    throw new Error(`The stem model returned ${tensor ? `[${tensor.dims.join(', ')}]` : 'nothing'}, expected [${expected.join(', ')}].`);
  }
  if (!(tensor.data instanceof Float32Array)) throw new Error('The stem model did not return float32 audio.');
  const data = tensor.data;
  const planes: Float32Array[] = [];
  for (let plane = 0; plane < stems * 2; plane += 1) {
    planes.push(data.slice(plane * samples, (plane + 1) * samples));
  }
  return planes;
}
