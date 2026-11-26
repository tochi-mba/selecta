/** How Beat This runs a whole song: `beat_this.inference.split_predict_aggregate` with the
 * Desktop's settings (chunks of 1500 frames, a border of 6, `keep_first`).
 *
 * The model was not trained on the edges of its input, so each chunk's first and last 6 frames
 * are thrown away and neighbouring chunks overlap by 6. The first chunk starts 6 frames before
 * the song (zeros), the last is moved left to end 6 frames past the song, and where chunks still
 * overlap the earlier chunk's frames are kept. A song shorter than one chunk is a single shorter
 * chunk. Frames nobody predicted read -1000, as in the package.
 */

export const BEAT_CHUNK = 1500;
export const BEAT_BORDER = 6;
export const UNPREDICTED = -1000;

export interface BeatChunk {
  /** First frame of the chunk in song frames; negative for the first chunk's zero padding. */
  start: number;
  /** Frames the model sees: real frames, plus zero frames where the chunk passes either end. */
  length: number;
  /** Zero frames before the song's first frame in this chunk. */
  padLeft: number;
  /** Song frames [from, to) the chunk reads. */
  from: number;
  to: number;
}

/** `split_piece(spect, 1500, border_size=6, avoid_short_end=True)`. */
export function splitPiece(frames: number, chunk = BEAT_CHUNK, border = BEAT_BORDER): BeatChunk[] {
  const starts: number[] = [];
  for (let start = -border; start < frames - border; start += chunk - 2 * border) starts.push(start);
  if (frames > chunk - 2 * border && starts.length) starts[starts.length - 1] = frames - (chunk - border);
  return starts.map((start) => {
    const from = Math.max(start, 0);
    const to = Math.min(start + chunk, frames);
    const padLeft = Math.max(0, -start);
    const padRight = Math.max(0, Math.min(border, start + chunk - frames));
    return { start, length: padLeft + (to - from) + padRight, padLeft, from, to };
  });
}

/** `aggregate_prediction(..., overlap_mode="keep_first")` for one output: writes `logits` of one
 * chunk into `piece`. Chunks must be given in order; a frame already written is kept. */
export function placeChunk(piece: Float32Array, written: Uint8Array, chunk: BeatChunk, logits: Float32Array, border = BEAT_BORDER): void {
  // the package slices [border, -border), so a chunk's last `border` frames are always dropped
  const usable = logits.length - 2 * border;
  for (let k = 0; k < usable; k += 1) {
    const at = chunk.start + border + k;
    if (at < 0 || at >= piece.length || written[at]) continue;
    piece[at] = logits[border + k];
    written[at] = 1;
  }
}
