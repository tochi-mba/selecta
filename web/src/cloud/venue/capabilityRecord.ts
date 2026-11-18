import type { ProbeResult } from '../../engine';
import type { Capability, StorageSpace } from '../../media';
import type { OutputRoute } from '../onboarding/state';
import type { DeviceIdentity } from './deviceIdentity';

/** One capability record per measured tuple (ADR-0460, BF-0460-01).
 *
 * A device's abilities come from runtime probes, never from who it says it is. The record is
 * filed under the full tuple the ADR names (`device_model + os_version + browser_engine/version +
 * engine_version + codec + media_source + output_type`) so a result is never borrowed by another
 * tuple, and it carries the probes that produced it: the worklet probe (engine/probe.ts), the
 * storage and import-surface probes (media/capabilities.ts), the codec answers, the synthetic DSP
 * benchmark, and the output and wake-lock APIs found by feature detection.
 *
 * "Signed-shape": `canonicalRecord` gives the exact bytes a signer would sign (sorted keys, no
 * whitespace) and `recordDigest` their SHA-256. Nothing here holds a signing key; a signature is
 * the server's to add when records are collected.
 *
 * A record is evidence of what ran, not a claim that anyone heard anything: audibility lives in
 * the sound check (soundCheckTruth.ts), and nothing in this file can set it.
 */

export const RECORD_SCHEMA = 'selecta.capability-record/1';

export type MediaSourceKind = 'local_file' | 'opfs_cache' | 'hosted_stream';

/** The full key, exactly the ADR's fields. Unknown parts are 'unknown', never guessed. */
export type CapabilityTuple = {
  device_model: string;
  os_version: string;
  browser_engine: string;
  browser_version: string;
  engine_version: string;
  codec: string;
  media_source: MediaSourceKind;
  output_type: OutputRoute | 'unknown';
};

export const TUPLE_FIELDS: readonly (keyof CapabilityTuple)[] = [
  'device_model', 'os_version', 'browser_engine', 'browser_version', 'engine_version', 'codec', 'media_source', 'output_type',
];

/** The browser's own answer to canPlayType: '' (no), 'maybe' or 'probably'. Not a decode test. */
export type CodecAnswer = '' | 'maybe' | 'probably';

export type BenchmarkResult =
  | { ran: true; implementation: string; blocks: number; worstBlockMs: number; medianBlockMs: number; budgetMsPerBlock: number }
  | { ran: false; reason: string };

export type Probes = {
  worklet: { ok: true; sampleRate: number; schedulingMisses: number; blocks: number } | { ok: false; reason: string };
  storage: { opfs: Capability; space: StorageSpace };
  pickers: { directoryInput: Capability; dirPicker: Capability };
  codecs: Record<string, CodecAnswer>;
  benchmark: BenchmarkResult;
  /** Feature detection only: whether the API exists, not whether a route was tested. */
  outputSelection: boolean;
  wakeLockApi: boolean;
};

export type CapabilityRecord = {
  schema: typeof RECORD_SCHEMA;
  key: string;
  tuple: CapabilityTuple;
  identity_source: DeviceIdentity['identity_source'];
  /** Seconds since epoch. */
  measured_at: number;
  probes: Probes;
};

/** The string a record is filed under: every tuple field, in the ADR's order. */
export function tupleKey(tuple: CapabilityTuple): string {
  return TUPLE_FIELDS.map((field) => `${field}=${encodeURIComponent(String(tuple[field]))}`).join('|');
}

export function workletEvidence(probe: ProbeResult): Probes['worklet'] {
  return probe.ok
    ? { ok: true, sampleRate: probe.sampleRate, schedulingMisses: probe.schedulingMisses, blocks: probe.blocks }
    : { ok: false, reason: probe.reason };
}

export function buildRecord(input: {
  identity: DeviceIdentity;
  engineVersion: string;
  codec: string;
  mediaSource: MediaSourceKind;
  output: OutputRoute | 'unknown';
  probes: Probes;
  measuredAt: number;
}): CapabilityRecord {
  const tuple: CapabilityTuple = {
    device_model: input.identity.device_model,
    os_version: input.identity.os_version,
    browser_engine: input.identity.browser_engine,
    browser_version: input.identity.browser_version,
    engine_version: input.engineVersion,
    codec: input.codec,
    media_source: input.mediaSource,
    output_type: input.output,
  };
  return {
    schema: RECORD_SCHEMA,
    key: tupleKey(tuple),
    tuple,
    identity_source: input.identity.identity_source,
    measured_at: input.measuredAt,
    probes: input.probes,
  };
}

/** Sorted keys, no whitespace: the same record always gives the same bytes. */
export function canonicalRecord(record: CapabilityRecord): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, sort((value as Record<string, unknown>)[key])]));
    }
    return value;
  };
  return JSON.stringify(sort(record));
}

/** SHA-256 of the canonical bytes, as hex; null where the browser has no WebCrypto digest. */
export async function recordDigest(record: CapabilityRecord): Promise<string | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle?.digest) return null;
  const bytes = new TextEncoder().encode(canonicalRecord(record));
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type Qualification =
  | { player: true; notes: string[] }
  | { player: false; reason: string; notes: string[] };

/** May this device present itself as a player? Decided by the measured probes alone.
 *
 * It takes `Probes`, not the record, on purpose: the identity labels are out of reach here, so no
 * brand, model or browser name can tip the answer (BF-0460-01, asserted by test). A passing answer
 * is still not audibility; the venue flow then asks a person to hear the check tone. */
export function qualification(probes: Probes): Qualification {
  const notes: string[] = [];
  if (!probes.worklet.ok) return { player: false, reason: probes.worklet.reason, notes };
  const playable = Object.values(probes.codecs).some((answer) => answer !== '');
  if (!playable) {
    return { player: false, reason: 'This browser says it cannot play any of the common music formats, so SelectaDJ cannot play here.', notes };
  }
  if (!probes.storage.opfs.supported) notes.push(probes.storage.opfs.reason ?? 'No private browser storage.');
  if (!probes.wakeLockApi) notes.push('This browser cannot keep the screen on by itself; turn off auto-lock in the device settings.');
  if (probes.benchmark.ran === false) notes.push(`The speed check did not run: ${probes.benchmark.reason}`);
  return { player: true, notes };
}
