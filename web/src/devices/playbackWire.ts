import { flagOn } from '../flags';
import { isOnline } from '../cloud/connection';
// The playback session's wire shapes, the ADR-0461 envelope check and the small helpers the
// playback hook and its controls share (split out of usePlaybackDevice.ts by concern).

export type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
export type Warning = { code: string; text: string };
export type Device = { id: string; name: string; kind: string; signed_in: boolean; this_device: boolean; poor_speaker: boolean; last_seen_at: number; warnings: Warning[] };
/** A programme entry as an ADR-0458 identity: resolved locally on the speaker, never a path. */
export type ProgrammeRef = { song_id: number; sha256: string };
/** Where a new speaker's first sound begins. */
export type StartAt = { song_index: number; offset_ms: number };
export type SessionState = { mix_revision_id: string | null; song_index: number; offset_ms: number; anchor_at: number | null; state: 'playing' | 'paused' | 'stopped'; active_device_id: string | null; lease_expires_at: number | null; seq: number; fence?: number; state_confidence?: 'fresh' | 'uncertain'; programme?: ProgrammeRef[]; track?: ProgrammeRef | null; output_status?: OutputWire; output_verified_at?: number | null; volume?: number | null };
/** The speaker's sound-output status as it reaches controllers (ADR-0457 truthful states, BF-0457-03). */
export type OutputWire = 'playing' | 'output_unverified' | 'uncertain' | 'interrupted';
/** A press held for an offline speaker (BF-0461-04): `reason` is deferred while it waits, or why it was dropped. */
export type HeldPress = { command_id: string; command: string; args?: Record<string, unknown>; issued_by: string; reason: 'deferred' | 'expired' | 'superseded' | 'stale'; created_at: number; expires_at: number | null; resolved_at: number | null };
export type Alternative = { song_id: number; title: string; artist: string; programme_index: number | null; same_song: boolean };
export type Unavailable = { command_id: string; command: string; issued_by: string; acked_at: number; song_id: number | null; alternatives: Alternative[] };
export type Notices = { missed: HeldPress[]; waiting: HeldPress[]; unavailable: Unavailable[] };
export type SessionView = { session: SessionState | null; speaker: 'here' | 'elsewhere' | 'offline' | 'none'; speaker_device_id: string | null; speaker_name: string | null; ask_before_playing_here: boolean; server_time: number; notices?: Notices | null; envelope_key?: string | null };
export type Position = { song_index: number; offset_ms: number; state: 'playing' | 'paused' };
/** The ADR-0461 envelope a speaker receives as a `playback.command` event and checks before acking. */
export type CommandEvent = { device_id: string | null; command: string; args?: Record<string, unknown>; seq: number; command_id: string; fence?: number | null; expires_at?: number | null; issued_by?: string; zone_id?: string | null; envelope?: string; signature?: string | null };
/** The signed fields inside `envelope` (BF-0461-01). */
type SignedEnvelope = { v: number; workspace_id: string; zone_id: string | null; device_id: string | null; issued_by: string; command: string; args: Record<string, unknown>; seq: number; command_id: string; fence: number; expires_at: number };
export type AckResult = 'applied' | 'unavailable_here';

/** Fired on window by the Cloud event stream for each `playback.command` event, so the speaker
 * hook hears commands without owning a second stream. `detail` is the event payload. */
export const PLAYBACK_COMMAND_EVENT = 'selecta-playback-command';
/** Commands the speaker carries out itself by following the session; anything else (mix
 * steering, requests) is the server's to apply, so the speaker says unavailable_here. */
export const SPEAKER_COMMANDS = new Set(['play', 'pause', 'skip', 'seek', 'set_programme', 'set_volume', 'stop']);
/** Commands that move the speaker to a (possibly missing) track. */
export const MOVES_TRACK = new Set(['skip', 'seek', 'set_programme']);
/** The most songs a session's programme may hold (the server's MAX_PROGRAMME). */
export const MAX_PROGRAMME = 1000;
/** A refused press the controller answers by redrawing from where the music is now. */
export const RETRY_CODES = new Set(['stale_command', 'superseded_command', 'expired_command']);

/** Whether a delivered command may still be acted on here: exactly this speaker's current fence,
 * and not past its expiry by the server's clock (ADR-0461). A future fence is no more ours than
 * an old one; learn ownership from a session response before acting on it. */
export function commandStillValid(event: Pick<CommandEvent, 'fence' | 'expires_at'>, knownFence: number | null, serverNow: number): boolean {
  if (event.expires_at != null && serverNow >= event.expires_at) return false;
  if (event.fence != null && event.fence !== knownFence) return false;
  return true;
}

const hexBytes = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Check an envelope's HMAC-SHA256 against this speaker's lease key (BF-0461-01). The HMAC is
 * over the exact text received, so no re-encoding can disagree with the server. */
export async function verifyEnvelope(keyHex: string, text: string, signature: string | null | undefined): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature) || !/^[0-9a-f]+$/.test(keyHex) || typeof crypto === 'undefined' || !crypto.subtle) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hexBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, hexBytes(signature), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

/** The command a speaker may act on: with a lease key, only a correctly signed envelope scoped
 * to this workspace and device, read from the signed text itself; without one (an older
 * server), the clear fields as before. Null: refuse it. */
export async function openEnvelope(event: CommandEvent, keyHex: string | null, workspaceId: string, deviceId: string): Promise<CommandEvent | null> {
  if (!keyHex) return event;
  if (!event.envelope || !(await verifyEnvelope(keyHex, event.envelope, event.signature))) return null;
  let signed: SignedEnvelope;
  try { signed = JSON.parse(event.envelope) as SignedEnvelope; } catch { return null; }
  if (signed.workspace_id !== workspaceId || signed.device_id !== deviceId || signed.command_id !== event.command_id) return null;
  return { device_id: signed.device_id, command: signed.command, args: signed.args, seq: signed.seq, command_id: signed.command_id, fence: signed.fence, expires_at: signed.expires_at, issued_by: signed.issued_by, zone_id: signed.zone_id, envelope: event.envelope, signature: event.signature };
}

/** What actually makes sound on this device. */
export interface Speaker {
  start(songIndex: number, offsetMs: number, playing: boolean): Promise<void>;
  stop(fadeMs: number): void;
  pause(): void;
  resume(): void;
  /** Apply a venue's shared volume as a normalized output level from 0 (muted) to 1. */
  setVolume?(level: number): void;
  position(): Position | null;
  active(): boolean;
  /** Release listeners and locally cached audio when the device UI unmounts. */
  dispose?(): void;
  /** The engine's truthful output status (BrowserSpeaker), reported with each heartbeat. */
  state?(): { phase?: string; output: { status: string; at?: number } };
  /** A wake lock that was granted and then revoked makes audibility uncertain. */
  wakeLockLost?(): void;
}

/** The heartbeat fields for what this speaker knows about its output: 'playing' only with the
 * time a person confirmed the check tone (ADR-0460), never inferred. Nothing when it can't say. */
export function outputReport(speaker: Speaker | null): { output_status: OutputWire; output_verified_at?: number } | Record<string, never> {
  const output = speaker?.state?.().output;
  if (!output) return {};
  if (output.status === 'verified_at' && typeof output.at === 'number') return { output_status: 'playing', output_verified_at: output.at };
  if (output.status === 'output_unverified' || output.status === 'uncertain' || output.status === 'interrupted') return { output_status: output.status };
  return {};
}

/** Fired on window once this browser has registered, so the devices list can mark it. */
export const DEVICE_REGISTERED = 'selecta-device-registered';
export const HEARTBEAT_MS = 5000;
export const SPEAKER_POLL_MS = 1000;
export const REMOTE_POLL_MS = 2000;
export const FADE_MS = 1000;
/** ADR-0475 G1: the mix level a session starts at before anyone sets one (comfortable, not full). */
export const DEFAULT_VOLUME = 80;
/** A new speaker rises to the session's level over this long, so a hand-over never jumps loud. */
export const VOLUME_RISE_MS = 1000;
/** The session's level as the speaker plays it: its own value, or the comfortable default. */
export const levelOf = (session: { volume?: number | null } | null | undefined) => (typeof session?.volume === 'number' ? session.volume : DEFAULT_VOLUME);
/** The old speaker hears within SPEAKER_POLL_MS and fades over FADE_MS; wait a little more. */
export const START_DELAY_MS = SPEAKER_POLL_MS + FADE_MS + 400;
/** Said when this device kept playing offline and found another device had taken over. */
export const TAKEN_OVER_WHILE_OFFLINE = 'Another device took over while this one was offline, so playback stopped here.';

export const offlinePlaybackOn = () => flagOn('cloud.offline_playback');
/** The presses a speaker can carry out on its own while offline. */
export const LOCAL_PRESSES = new Set(['play', 'pause', 'skip', 'seek', 'set_volume']);
/** A failure that means SelectaDJ could not be reached or answer just now, not a refusal. */
export function couldNotReach(problem: unknown): boolean {
  if (!isOnline()) return true;
  const status = (problem as { status?: unknown } | null)?.status;
  // no answer at all (fetch's TypeError, an abort or timeout), or the service down or busy
  if (typeof status !== 'number') return problem instanceof TypeError || ['AbortError', 'TimeoutError', 'OfflineError'].includes(String((problem as { name?: unknown } | null)?.name));
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** A press that never reached SelectaDJ at all: no network, or no answer. A busy or failing
 * server (429, 5xx) did answer, so the press is refused and said so; the speaker does not start
 * acting alone and showing offline words while the connection is fine. */
export function neverReached(problem: unknown): boolean {
  if (!isOnline()) return true;
  const status = (problem as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return problem instanceof TypeError || ['AbortError', 'TimeoutError', 'OfflineError'].includes(String((problem as { name?: unknown } | null)?.name));
  return status === 0 || status === 408;
}
/** Said when a press found nobody playing: the session answers `no_speaker` to Play. */
export const NO_SPEAKER_WORDS = 'Nothing is playing on another device right now. Choose a device to play on.';

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Where the music is now, worked out from the session's anchor and the server's clock. */
export function extrapolate(session: SessionState, serverNow: number): number {
  if (session.state !== 'playing' || session.anchor_at === null) return session.offset_ms;
  return session.offset_ms + Math.max(0, Math.round((serverNow - session.anchor_at) * 1000));
}
