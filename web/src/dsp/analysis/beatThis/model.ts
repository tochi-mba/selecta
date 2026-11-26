/** The neural beat tracker's model file: what it is and keeping it on this device.
 *
 * Beat This `small0`, exported by `tools/beat_this_onnx_export.py`; artefact.json is that
 * tool's record (hash, size, source checkpoint and its hash, licence). The file is fetched from
 * SelectaDJ's own site, at a path that carries its hash, verified by SHA-256 and kept in OPFS,
 * exactly as the stem model is (stems/model.ts does the fetching, resuming and verifying for
 * both). Nothing about a song is ever sent; the only request is for this file.
 */

import { readStemModelBytes, StemModelManager, type ModelDirectory, type StemModelArtefact, type StemModelManagerOptions } from '../../stems/model';
import { NEURAL_BEATS_IMPLEMENTATION } from '../deviceAnalysisIds';
import record from './artefact.json';

export const BEAT_MODEL_IMPLEMENTATION = NEURAL_BEATS_IMPLEMENTATION;

/** The Tier 3 record this model is evaluated under (ADR-0459, BF-0459-07). */
export const BEATS_TIER3_RECORD_ID = 'bf-tier3-beat-this-2026-11-26';

/** Set to BEATS_TIER3_RECORD_ID only once every section of
 * docs/verification/bf-tier3-beat-this-2026-11-26.md says PASS and the owner has signed it.
 * Until then the browser keeps its interim beat source on every device. */
export const BEATS_LICENCE_RECORD: string | null = null;

/** Where the file is served on SelectaDJ's own site: `/models/beat-this/<id>/<sha256>.onnx`. */
export function beatModelUrl(origin = typeof location !== 'undefined' ? location.origin : ''): string {
  return `${origin.replace(/\/+$/, '')}${record.path}`;
}

export const BEAT_MODEL_ARTEFACT: StemModelArtefact = {
  implementation: record.implementation,
  url: record.path,
  sha256: record.sha256,
  bytes: record.bytes,
};

export function beatModelFileName(sha256: string): string {
  return `cache-beats-model-${sha256}.onnx`;
}

const MARKER_KEY = 'selecta.dsp.beats.model';

/** The manager for this model, over the same code the stem splitter uses. */
export function beatModelManager(options: Omit<StemModelManagerOptions, 'fileName' | 'markerKey' | 'noun'> = {}): StemModelManager {
  return new StemModelManager({
    artefact: { ...BEAT_MODEL_ARTEFACT, url: beatModelUrl() },
    ...options,
    fileName: beatModelFileName,
    markerKey: MARKER_KEY,
    noun: 'beat tracker',
  });
}

/** Whether this browser has verified the file (the manager's marker), read without touching
 * OPFS, so the capability roster can say so synchronously. */
export function beatModelVerifiedHere(): boolean {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    const marker = raw ? (JSON.parse(raw) as { sha256?: string; bytes?: number }) : null;
    return marker?.sha256 === BEAT_MODEL_ARTEFACT.sha256 && marker.bytes === BEAT_MODEL_ARTEFACT.bytes;
  } catch {
    return false;
  }
}

/** The verified file's bytes, in the worker. */
export function readBeatModelBytes(root?: () => Promise<ModelDirectory | null>): Promise<ArrayBuffer | null> {
  return readStemModelBytes(BEAT_MODEL_ARTEFACT.sha256, root, beatModelFileName);
}
