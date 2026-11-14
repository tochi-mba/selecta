/** Word cuts require independent local acoustic evidence, not a lyric guess or Cloud claim. */
export interface WordBoundary {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string; // local use ONLY; must never enter Cloud.
  readonly origin: "manual" | "forced_alignment" | "guess";
  readonly acousticCheckpointSha256?: string;
  readonly independentScore?: number;
  readonly independentlyChecked?: boolean;
}
export interface CalibratedWordGate {
  readonly checkpointSha256: string;
  readonly threshold: number;
  readonly calibratedOn: string; // non-empty human-reviewed evaluation identifier
}
export type WordVerdict = {reliable: true} | {reliable: false; reason: string};
export function verifyWordBoundary(boundary: WordBoundary, gate: CalibratedWordGate | null): WordVerdict {
  if (!(Number.isFinite(boundary.startSeconds) && Number.isFinite(boundary.endSeconds) &&
      boundary.startSeconds >= 0 && boundary.endSeconds > boundary.startSeconds &&
      boundary.endSeconds - boundary.startSeconds < 10)) {
    return {reliable:false, reason:"invalid_timing"};
  }
  if (boundary.origin === "manual") return {reliable:false, reason:"requires_local_operator_confirmation"};
  if (boundary.origin !== "forced_alignment" || !boundary.independentlyChecked) {
    return {reliable:false, reason:"unverified_alignment"};
  }
  if (!gate || !gate.calibratedOn || !/^[a-f0-9]{64}$/i.test(gate.checkpointSha256) ||
      gate.checkpointSha256 !== boundary.acousticCheckpointSha256 ||
      !Number.isFinite(gate.threshold) || gate.threshold <= 0 || gate.threshold > 1 ||
      !Number.isFinite(boundary.independentScore) || (boundary.independentScore ?? -1) < gate.threshold) {
    return {reliable:false, reason:"missing_calibrated_independent_evidence"};
  }
  return {reliable:true};
}
