/** Metadata-only client contract for ADR-0455/0466/0469. No media URLs or paths. */
export const LOCAL_FIRST_PLAYER_FLAG = 'local_first.player_v1';
export const TELEMETRY_FRESH_MS = 15_000;
export const READINESS_FRESH_MS = 30_000;
export const COMMAND_TTL_MS = 20_000;

export type Connection = 'online' | 'offline' | 'unknown';
export type OutputState = 'audible' | 'silent' | 'unverified' | 'disconnected';
export type TrackAvailability =
  | 'ready' | 'needs_analysis' | 'candidate_match' | 'missing' | 'source_disconnected'
  | 'permission_required' | 'unsupported' | 'version_mismatch' | 'policy_blocked'
  | 'engine_offline' | 'device_unknown' | 'cache_invalid';

export interface LocalOutput {
  id: string;
  name: string;
  health: 'ready' | 'disconnected' | 'permission_required' | 'unknown';
}

export interface LocalDevice {
  device_id: string;
  name: string;
  this_device: boolean;
  role: 'local_engine' | 'controller_only';
  connectivity: Connection;
  last_confirmed_server_at: string | null;
  outputs: LocalOutput[];
}

export interface LocalSession {
  workspace_id: string;
  speaker_device_id: string | null;
  speaker_name: string | null;
  output_id: string | null;
  output_name: string | null;
  generation: number;
  recipe_revision: string | null;
  state: 'playing' | 'paused' | 'stopped' | 'unknown';
  /** Real agent observation, not an ACK or the expiration of a cloud lease. */
  output_state: OutputState;
  observed_at: string | null;
  /** False includes an unreachable/partitioned previous speaker. */
  original_can_be_fenced: boolean;
}

export interface DeviceReadiness {
  target_device_id: string;
  recipe_revision: string;
  status: 'ready' | 'needs_attention' | 'unknown';
  last_verified_at: string | null;
  output_id: string | null;
  tracks: Array<{ occurrence_id: string; state: TrackAvailability; reason: string | null }>;
  transition_states: Array<{ index: number; state: string }>;
}

export type CommandKind = 'play' | 'pause' | 'skip' | 'takeover' | 'change_output';
export type TransportStage =
  | 'requested' | 'prepared' | 'queued' | 'applied' | 'failed' | 'expired' | 'uncertain';

export type WireCommandState =
  | 'created' | 'authorised' | 'queued' | 'delivered' | 'accepted' | 'applied'
  | 'acknowledged' | 'rejected' | 'expired' | 'superseded' | 'conflicted' | 'failed';

export interface LocalCommand {
  schema_version: 1;
  operation_id: string;
  idempotency_key: string;
  workspace_id: string;
  target_device_id: string;
  expected_generation: number;
  expected_recipe_revision: string | null;
  expires_at: string;
  command: CommandKind;
  arguments: Record<string, string | number | boolean | null>;
}

export interface CommandReceipt {
  operation_id: string;
  state: WireCommandState;
  applied_generation: number | null;
  reason: string | null;
}

export interface Preflight {
  preflight_id: string;
  expires_at: string;
  safe: boolean;
  reason: string | null;
  target_device_id: string;
  expected_generation: number;
  recipe_revision: string;
  output_id: string;
}

export const isFresh = (when: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean => {
  if (!when) return false;
  const time = Date.parse(when);
  return Number.isFinite(time) && time <= now + 2_000 && now - time <= maxAgeMs;
};

export function audibleTruth(session: LocalSession | null, now = Date.now()): string {
  if (!session?.speaker_device_id || session.state === 'stopped') return 'No confirmed speaker';
  const speaker = session.speaker_name ?? 'another device';
  const output = session.output_name ?? session.output_id ?? 'unknown output';
  if (!isFresh(session.observed_at, TELEMETRY_FRESH_MS, now)) {
    return `Last reported: ${speaker} · ${output}; current sound unverified`;
  }
  if (session.output_state === 'audible' && session.state === 'playing') return `Playing on ${speaker} · ${output}`;
  if (session.state === 'paused') return `Paused on ${speaker} · ${output}`;
  if (session.output_state === 'silent') return `${speaker} · ${output} is silent (output failure)`;
  return `${speaker} · ${output}: output not confirmed`;
}

export function readinessReason(
  target: LocalDevice | null, readiness: DeviceReadiness | null,
  session: LocalSession | null, outputId: string | null, now = Date.now(),
): string | null {
  if (!target || target.role !== 'local_engine') return 'This browser is controller-only; connect an authorised local engine to play here.';
  if (target.connectivity !== 'online' || !isFresh(target.last_confirmed_server_at, TELEMETRY_FRESH_MS, now)) {
    return 'The destination engine is offline or its heartbeat is stale.';
  }
  if (!outputId || target.outputs.find((item) => item.id === outputId)?.health !== 'ready') {
    return 'Choose a verified, connected local audio output.';
  }
  if (!session?.recipe_revision) return 'Choose a mix revision before requesting playback.';
  if (!readiness || readiness.target_device_id !== target.device_id ||
      readiness.recipe_revision !== session.recipe_revision || readiness.output_id !== outputId ||
      !isFresh(readiness.last_verified_at, READINESS_FRESH_MS, now)) {
    return 'Media readiness is unknown or stale. Verify exact local recordings first.';
  }
  const unresolved = readiness.tracks.filter((entry) => entry.state !== 'ready');
  if (readiness.status !== 'ready' || unresolved.length ||
      readiness.transition_states.some((item) => item.state !== 'ready')) {
    return unresolved.length
      ? `${unresolved.length} local recordings need attention; repair them on this device before playback.`
      : 'Transitions or local playback prerequisites are not ready.';
  }
  if (!session.original_can_be_fenced && session.speaker_device_id && session.speaker_device_id !== target.device_id) {
    return 'Unsafe takeover: the original speaker cannot be fenced and may still be audible.';
  }
  return null;
}

export function stageFor(receipt: CommandReceipt | null, pending: TransportStage): TransportStage {
  if (!receipt) return pending;
  switch (receipt.state) {
    case 'applied':
    case 'acknowledged': return 'applied';
    case 'expired': return 'expired';
    case 'failed':
    case 'rejected':
    case 'conflicted':
    case 'superseded': return 'failed';
    default: return 'queued';
  }
}

export function verifiedCount(readiness: DeviceReadiness | null): string {
  if (!readiness) return 'Not verified';
  return `${readiness.tracks.filter((track) => track.state === 'ready').length}/${readiness.tracks.length} verified local recordings`;
}
