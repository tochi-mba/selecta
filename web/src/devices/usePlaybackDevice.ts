import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserName, capabilities, currentFacts, deviceKind } from './deviceInfo';
import { holdWakeLock, WakeLockHold } from './wakeLock';
import { flagOn } from '../flags';
import { isOnline, onReconnect } from '../cloud/connection';
import { audioTab, tabLog } from './audioTab';

// This browser as a playback device, and the account's one playback session (ADR-0415).
//
// - The device registers once per workspace and keeps its id in local storage.
// - While it's the speaker it heartbeats every 5 s and checks the session every second, so when
//   another device takes over it hears within a second and fades out over one.
// - "Play here" takes the lease, says "Starting here...", and waits long enough for the old
//   speaker to have heard and faded before it starts: a short gap, never two speakers at once.
// - A remote's buttons send commands with the sequence they were based on and a fresh
//   idempotency key; a stale press redraws from the server and asks to try again.
// - cloud.offline_playback: when heartbeats fail because SelectaDJ can't be reached (no network,
//   a timeout, the service down), not because the server refused or another device took over,
//   the speaker keeps playing its own files and queue past the lease ("adrift"). Pause, skip,
//   seek and volume act on this device at once. When the connection is back it reconciles with
//   /playback/reconnect; if another device took over meanwhile it stops here and says so.

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
export const SPEAKER_COMMANDS = new Set(['play', 'pause', 'skip', 'seek', 'set_programme', 'set_volume']);
/** Commands that move the speaker to a (possibly missing) track. */
const MOVES_TRACK = new Set(['skip', 'seek', 'set_programme']);
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
/** The old speaker hears within SPEAKER_POLL_MS and fades over FADE_MS; wait a little more. */
export const START_DELAY_MS = SPEAKER_POLL_MS + FADE_MS + 400;
/** Said when this device kept playing offline and found another device had taken over. */
export const TAKEN_OVER_WHILE_OFFLINE = 'Another device took over while this one was offline, so playback stopped here.';

const offlinePlaybackOn = () => flagOn('cloud.offline_playback');
/** The presses a speaker can carry out on its own while offline. */
const LOCAL_PRESSES = new Set(['play', 'pause', 'skip', 'seek', 'set_volume']);
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

const storedKey = (workspaceId: string) => `selecta.device.${workspaceId}`;
function stored(workspaceId: string): string | null {
  try { return localStorage.getItem(storedKey(workspaceId)); } catch { return null; }
}
function remember(workspaceId: string, id: string) {
  try { localStorage.setItem(storedKey(workspaceId), id); } catch { /* the cookie still names it */ }
}
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Where the music is now, worked out from the session's anchor and the server's clock. */
export function extrapolate(session: SessionState, serverNow: number): number {
  if (session.state !== 'playing' || session.anchor_at === null) return session.offset_ms;
  return session.offset_ms + Math.max(0, Math.round((serverNow - session.anchor_at) * 1000));
}

/** `remoteControl` false (`devices.remote_control` off): the speaker keeps playing as it is and
 * applies no command from another device, even one that reached the session before the switch. */
export function usePlaybackDevice({ api, workspaceId, speaker, remoteControl = true }: { api: Api; workspaceId: string; speaker: Speaker | null; remoteControl?: boolean }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<SessionView | null>(null);
  const viewSnapshot = useRef<SessionView | null>(null);
  const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  // A refused press explains itself; the follow-up poll must not wipe that answer.
  const commandRefused = useRef(false);
  const clockOffset = useRef(0);
  // A slow poll must never overwrite a newer ownership decision.
  const latestPoll = useRef(0);
  /** How many session looks are in flight (see poll). */
  const looking = useRef(0);
  // Never let cached/buffered audio outlive the server-issued exclusive lease.
  const leaseDeadline = useRef<number | null>(null);
  // Expiry silences cached audio, but reconnect may resume if the server still owns it.
  const expiredSpeaker = useRef(false);
  const recoveringExpired = useRef(false);
  const claiming = useRef(false);
  const speaking = useRef(false);
  const appliedSeq = useRef(-1);
  /** True while this speaker's own set_programme is on its way: see publishProgramme. */
  const publishing = useRef(false);
  // ADR-0461: the newest fence this device has seen, sent with heartbeats and checked on commands.
  const fence = useRef<number | null>(null);
  const acked = useRef(new Set<string>());
  // BF-0461-01: the key this device verifies command envelopes with while it holds the lease.
  const envelopeKey = useRef<string | null>(null);
  const learnKey = (key: string | null | undefined) => { if (key) envelopeKey.current = key; };
  const adopt = (session: SessionState | null | undefined) => {
    if (session && typeof session.fence === 'number' && (fence.current === null || session.fence >= fence.current)) fence.current = session.fence;
  };
  const wake = useRef<WakeLockHold | null>(null);
  const wakeWasHeld = useRef(false);
  // cloud.offline_playback: playing on past the lease while SelectaDJ can't be reached
  const adrift = useRef(false);
  const beatTrouble = useRef(false);
  const reconciling = useRef(false);
  // a volume set here while offline, sent once the connection is back
  const heldVolume = useRef<number | null>(null);
  // the speaker an offline start made, until it reaches this hook as the `speaker` prop
  const offlineSpeaker = useRef<Speaker | null>(null);
  const [offline, setOffline] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState('');
  // offline at page open: the id this browser registered before stands in until it can register
  const [standIn, setStandIn] = useState<string | null>(null);
  const [registerTry, setRegisterTry] = useState(0);
  const deviceId = device?.id ?? standIn;
  // ADR-0475 F: which tab of this browser makes the sound (one device, many tabs: never two)
  const tab = useMemo(() => audioTab(workspaceId), [workspaceId]);
  // let go on unmount, but keep the channel: React's development double mount runs this cleanup
  // and then uses the same tab again, which must still hear the other tabs (a closed channel
  // left the audio tab deaf to 'let go', so no other tab could ever take the sound)
  useEffect(() => () => tab.release(), [tab]);
  // another tab of this browser is the one making the sound
  const [otherTab, setOtherTab] = useState(false);

  useEffect(() => {
    let current = true;
    const facts = currentFacts();
    const kind = deviceKind(facts);
    api<{ device: Device; notice: string | null }>('/devices', {
      method: 'POST',
      body: JSON.stringify({ device_id: stored(workspaceId), name: browserName(facts), kind, capabilities: capabilities(facts) }),
    }, workspaceId).then((made) => {
      if (!current) return;
      remember(workspaceId, made.device.id);
      setDevice(made.device);
      window.dispatchEvent(new CustomEvent(DEVICE_REGISTERED, { detail: made.device.id }));
      setNotice(made.notice ?? '');
    }).catch((problem: Error) => {
      if (!current) return;
      if (offlinePlaybackOn() && couldNotReach(problem)) {
        setStandIn(stored(workspaceId));
        return;
      }
      setError(problem.message);
    });
    return () => { current = false; };
  }, [api, workspaceId, registerTry]);
  // registered later, once the connection is back
  useEffect(() => {
    if (device) return;
    return onReconnect(() => setRegisterTry((count) => count + 1));
  }, [device]);

  const serverNow = () => Date.now() / 1000 + clockOffset.current;

  const learnClock = (sentAt: number, serverTime: number) => {
    const midpoint = (sentAt + Date.now()) / 2000;
    clockOffset.current = serverTime - midpoint;
  };

  const becomeRemote = useCallback((why: string, fadeMs = FADE_MS) => {
    if (!speaking.current) return;
    speaking.current = false;
    tab.release();
    adrift.current = false;
    beatTrouble.current = false;
    setOffline(false);
    envelopeKey.current = null;
    leaseDeadline.current = null;
    expiredSpeaker.current = false;
    speaker?.stop(fadeMs);
    wake.current?.release();
    wake.current = null;
    wakeWasHeld.current = false;
    setMessage(why);
  }, [speaker, tab]);
  // another tab of this browser took the sound: stop here at once, before it starts
  useEffect(() => {
    tab.onTaken(() => {
      if (!speaking.current) return;
      speaking.current = false;
      expiredSpeaker.current = false;
      speaker?.stop(0);
      setOtherTab(true);
    });
  }, [speaker, tab]);

  /** The sound could not start here. The session is told it stopped (so no device reads
   * "Playing on" over silence while the lease runs out), and this device becomes a remote. */
  const couldNotStart = useCallback((session: SessionState, why: string) => {
    if (deviceId && speaking.current) {
      void api('/playback/heartbeat', {
        method: 'POST', body: JSON.stringify({ device_id: deviceId, song_index: session.song_index, offset_ms: Math.max(0, Math.round(session.offset_ms)), state: 'stopped', seq: appliedSeq.current, ...(fence.current === null ? {} : { fence: fence.current }), output_status: 'interrupted' }),
      }, workspaceId).catch(() => undefined);
    }
    becomeRemote(why, 0);
  }, [api, becomeRemote, deviceId, workspaceId]);

  const startSpeaking = useCallback(async (session: SessionState) => {
    if (!speaker) return;
    speaking.current = true;
    expiredSpeaker.current = false;
    adopt(session);
    leaseDeadline.current = session.lease_expires_at;
    appliedSeq.current = session.seq;
    if (!wake.current) wake.current = holdWakeLock();
    wakeWasHeld.current = false;
    if (typeof session.volume === 'number') speaker.setVolume?.(Math.min(1, Math.max(0, session.volume / 100)));
    try {
      await speaker.start(session.song_index, extrapolate(session, serverNow()), session.state === 'playing');
    } catch (problem) {
      // it could not make sound: stop holding the lease, or every other device would read
      // "Playing on this device" over silence
      couldNotStart(session, 'This device couldn’t start playing.');
      throw problem;
    }
  }, [couldNotStart, speaker]);

  /** Follow a session this device is the speaker of: play, pause, skip and seek from remotes. */
  const follow = useCallback(async (session: SessionState) => {
    if (!speaker || session.seq <= appliedSeq.current) return;
    // this speaker is telling the session its own programme: nothing for it to move to yet.
    // Nothing is marked applied here, so a skip or seek that landed meanwhile is carried out on
    // the next look (publishProgramme marks its own change when the session answers).
    if (publishing.current) return;
    appliedSeq.current = session.seq;
    if (!remoteControl) return;
    if (typeof session.volume === 'number') speaker.setVolume?.(Math.min(1, Math.max(0, session.volume / 100)));
    const here = speaker.position();
    const target = extrapolate(session, serverNow());
    const moved = !here || here.song_index !== session.song_index || Math.abs(here.offset_ms - target) > 2500;
    if (moved) {
      try {
        await speaker.start(session.song_index, target, session.state === 'playing');
      } catch {
        // a skip or seek from another device that this one could not play: say so, stop here
        // truthfully, and leave the music to a device that can
        couldNotStart({ ...session, offset_ms: target }, 'This device couldn’t play that song, so playback stopped here.');
      }
    } else if (session.state === 'paused' && speaker.active()) speaker.pause();
    else if (session.state === 'playing' && !speaker.active()) speaker.resume();
  }, [couldNotStart, speaker, remoteControl]);

  // Once a missed-lease safeguard silences the device, reconnect under the server's
  // session lock. If someone else took over, stay silent; otherwise resume from the
  // authoritative server position. This does not unpause an explicitly paused session.
  const recoverExpired = useCallback(async () => {
    if (!expiredSpeaker.current || recoveringExpired.current || !deviceId || !speaker) return;
    recoveringExpired.current = true;
    try {
      const answer = await api<{ action: string; session: SessionState | null; message: string | null; envelope_key?: string | null }>(
        '/playback/reconnect',
        { method: 'POST', body: JSON.stringify({ device_id: deviceId }) },
        workspaceId,
      );
      if (!expiredSpeaker.current) return;
      expiredSpeaker.current = false;
      if (answer.action === 'continue' && answer.session) {
        learnKey(answer.envelope_key);
        if (!(await tab.claim(false))) { setOtherTab(true); return; }
        await startSpeaking(answer.session);
        setMessage('');
      } else {
        setMessage(answer.message ?? 'Playback moved to another device.');
      }
    } catch {
      // Retry after a later successful session poll, not in a tight loop.
    } finally {
      recoveringExpired.current = false;
    }
  }, [api, deviceId, speaker, startSpeaking, tab, workspaceId]);

  /** A volume set here while offline goes to the session once the connection is back. */
  const sendHeldVolume = useCallback(async () => {
    const volume = heldVolume.current;
    const session = viewSnapshot.current?.session;
    if (volume === null || !deviceId) return;
    if (!remoteControl || !session || typeof session.volume !== 'number') { heldVolume.current = null; return; }
    try {
      await api('/playback/commands', {
        method: 'POST',
        body: JSON.stringify({ device_id: deviceId, command: 'set_volume', args: { volume }, based_on_seq: session.seq, fence: session.fence, ttl_seconds: 60, idempotency_key: newKey() }),
      }, workspaceId);
      if (heldVolume.current === volume) heldVolume.current = null;
    } catch (problem) {
      // still unreachable: kept for the next return; refused: the session's volume stands
      if (!couldNotReach(problem)) heldVolume.current = null;
    }
  }, [api, deviceId, remoteControl, workspaceId]);

  /** Back from playing offline: settle the lease with the server, or stop here if another device
   * took over meanwhile. Music keeps going while this runs; nothing restarts. */
  const reconcile = useCallback(async () => {
    if (!adrift.current || reconciling.current || !deviceId || !speaker || !isOnline()) return;
    reconciling.current = true;
    const carryOn = (session: SessionState, key: string | null | undefined) => {
      adrift.current = false;
      beatTrouble.current = false;
      setOffline(false);
      adopt(session);
      learnKey(key);
      leaseDeadline.current = session.lease_expires_at;
      void sendHeldVolume();
    };
    const stopHere = (why: string) => {
      heldVolume.current = null;
      setOfflineNotice(why);
      becomeRemote(why);
    };
    try {
      const answer = await api<{ action: string; session: SessionState | null; message: string | null; reason?: string | null; moved_to_name?: string | null; envelope_key?: string | null }>(
        '/playback/reconnect', { method: 'POST', body: JSON.stringify({ device_id: deviceId }) }, workspaceId,
      );
      if (!adrift.current) return;
      if (answer.action === 'continue' && answer.session) return carryOn(answer.session, answer.envelope_key);
      if (answer.reason === 'signed_out') return stopHere(answer.message ?? 'This device was signed out, so playback stopped.');
      // Nobody held the lease (this device started offline, or no one else played): a heartbeat
      // takes it only when no other device holds a live one and this one's fence is current.
      const at = speaker.position();
      if (at) {
        const sentAt = Date.now();
        const beat = await api<{ outcome: string; session: SessionState; server_time: number; envelope_key?: string | null }>('/playback/heartbeat', {
          method: 'POST', body: JSON.stringify({ device_id: deviceId, ...at, seq: appliedSeq.current, ...(fence.current === null ? {} : { fence: fence.current }), ...outputReport(speaker) }),
        }, workspaceId);
        learnClock(sentAt, beat.server_time);
        if (!adrift.current) return;
        if (beat.outcome !== 'refused') {
          appliedSeq.current = Math.max(appliedSeq.current, beat.session.seq);
          return carryOn(beat.session, beat.envelope_key);
        }
      }
      stopHere(answer.moved_to_name ? `${answer.moved_to_name} took over while this device was offline, so playback stopped here.` : TAKEN_OVER_WHILE_OFFLINE);
    } catch (problem) {
      if (!adrift.current) return;
      // still can't reach SelectaDJ: keep playing and try again on the next return
      if (couldNotReach(problem)) return;
      const status = (problem as { status?: number }).status;
      stopHere(status === 403 ? 'This device was signed out, so playback stopped.' : 'SelectaDJ couldn’t confirm this device should keep playing, so playback stopped here.');
    } finally {
      reconciling.current = false;
    }
  }, [api, becomeRemote, deviceId, sendHeldVolume, speaker, workspaceId]);
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;
  useEffect(() => onReconnect(() => void reconcileRef.current()), []);
  // a stand-in id swapped for the registered one, or a speaker that arrives later, tries again
  useEffect(() => { if (adrift.current) void reconcile(); }, [reconcile]);

  const poll = useCallback(async (forDecision = false): Promise<SessionView | null> => {
    if (!deviceId) return null;
    // On a connection slower than the timer, a new look every tick threw away every answer
    // (only the newest counts), so a speaker never followed a press. A regular look waits for
    // the one in flight; a look that a press or a decision needs always goes.
    if (!forDecision && looking.current > 0) return null;
    const requestId = ++latestPoll.current;
    const sentAt = Date.now();
    looking.current += 1;
    try {
      const next = await api<SessionView>(`/playback/session?device_id=${encodeURIComponent(deviceId)}`, {}, workspaceId);
      // A reconnect/background poll can start after a person's button press. It must not
      // discard that button's authoritative answer: the UI still needs to ask before
      // taking an existing lease. Only the most recent response changes shared state.
      if (requestId !== latestPoll.current) return forDecision ? next : null;
      learnClock(sentAt, next.server_time);
      adopt(next.session);
      if (next.speaker === 'here') learnKey(next.envelope_key);
      viewSnapshot.current = next;
      setView(next);
      if (!commandRefused.current) setError('');
      // playing on offline: the reconnect decides who speaks, never a session read alone
      if (adrift.current) {
        void reconcileRef.current();
        return next;
      }
      if (expiredSpeaker.current) {
        if (next.speaker === 'here') void recoverExpired();
        else {
          expiredSpeaker.current = false;
          setMessage(next.speaker_name ? `Playback moved to ${next.speaker_name}` : 'Playback stopped.');
        }
      }
      if (speaking.current && next.speaker === 'here' && next.session) {
        leaseDeadline.current = next.session.lease_expires_at;
      }
      // this device is the speaker but this tab is not making the sound: another tab is
      setOtherTab(next.speaker === 'here' && !speaking.current && !tab.holds() && !claiming.current);
      if (speaking.current && next.speaker !== 'here') {
        becomeRemote(next.speaker_name ? `Playback moved to ${next.speaker_name}` : 'Playback stopped.');
      } else if (speaking.current && next.session) {
        await follow(next.session);
      }
      return next;
    } catch (problem) {
      if (requestId !== latestPoll.current) return null;
      const status = (problem as { status?: number }).status;
      if (status === 403) becomeRemote('This device was signed out, so playback stopped.');
      // offline is said once by the connection banner, not as a raw error under the player
      if (!(offlinePlaybackOn() && couldNotReach(problem))) setError((problem as Error).message);
      return null;
    } finally {
      looking.current -= 1;
    }
  }, [api, becomeRemote, deviceId, follow, recoverExpired, tab, workspaceId]);

  // When the page opens on the device that was the speaker, carry on or fade out as the
  // server says (it may have moved while this one was away).
  useEffect(() => {
    if (!deviceId || !speaker) return;
    let current = true;
    api<{ action: string; session: SessionState | null; message: string | null; envelope_key?: string | null }>('/playback/reconnect', {
      method: 'POST', body: JSON.stringify({ device_id: deviceId }),
    }, workspaceId).then(async (answer) => {
      if (current && answer.action === 'continue' && answer.session) {
        learnKey(answer.envelope_key);
        // The device may have lost the lease while its reconnect response was in
        // flight. Never resurrect audio from that earlier grant on a reloaded tab.
        const verified = await poll(true);
        if (!current) return;
        // a press on this reloaded tab is already taking over (or has): it starts the sound
        if (claiming.current || speaking.current) return;
        if (verified?.speaker === 'here' && verified.session) {
          // another tab of this browser is already making the sound: this one stays quiet
          if (!(await tab.claim(false))) { setOtherTab(true); return; }
          await startSpeaking(verified.session);
        } else if (!verified) {
          // Reconnect succeeded but verification could not reach the server.
          // Keep quiet and retry only after a later successful session poll.
          expiredSpeaker.current = true;
        }
      }
    }).catch(() => undefined).finally(() => { if (current) void poll(); });
    return () => { current = false; };
  }, [api, deviceId, poll, speaker, startSpeaking, tab, workspaceId]);

  useEffect(() => {
    if (!deviceId) return;
    const timer = window.setInterval(() => void poll(), speaking.current || starting ? SPEAKER_POLL_MS : REMOTE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [deviceId, poll, starting, view?.speaker]);

  // A partitioned browser cannot renew the lease. Let it use its buffered audio for a
  // short interruption, but stop at the lease deadline so a different device may play
  // without unbounded double audio once the backend permits a new owner.
  useEffect(() => {
    if (!deviceId) return;
    const timer = window.setInterval(() => {
      if (adrift.current) {
        if (isOnline()) void reconcileRef.current();
        return;
      }
      if (speaking.current && leaseDeadline.current !== null && serverNow() >= leaseDeadline.current) {
        // cloud.offline_playback: the lease lapsed only because SelectaDJ can't be reached, so
        // this device keeps playing its own files and settles up when the connection is back
        if (offlinePlaybackOn() && (beatTrouble.current || !isOnline())) {
          adrift.current = true;
          setOffline(true);
          if (isOnline()) void reconcileRef.current();
          return;
        }
        becomeRemote('Playback stopped because this device could not renew its audio lease.', 0);
        expiredSpeaker.current = true;
      }
    }, SPEAKER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [becomeRemote, deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    // WakeLockHold intentionally owns its browser sentinel, so sample its public state here.
    // A granted lock that disappears is evidence of uncertainty; an unsupported wake-lock API
    // (always false) does not by itself downgrade output.
    const watchWakeLock = window.setInterval(() => {
      const held = wake.current?.held() ?? false;
      if (speaking.current && wakeWasHeld.current && !held) speaker?.wakeLockLost?.();
      wakeWasHeld.current = held;
    }, 1000);
    return () => window.clearInterval(watchWakeLock);
  }, [deviceId, speaker]);

  useEffect(() => {
    if (!deviceId) return;
    const beat = window.setInterval(async () => {
      if (!speaking.current || !speaker) return;
      const at = speaker.position() ?? (() => {
        // A route switch or interruption can pause the graph and make its position
        // unavailable for a beat. Keep the lease and output report current from the last
        // server snapshot, while reporting the engine's phase truthfully.
        const session = viewSnapshot.current?.session;
        if (!session) return null;
        const phase = speaker.state?.().phase;
        return {
          song_index: session.song_index,
          offset_ms: extrapolate(session, serverNow()),
          state: phase === 'idle' ? 'stopped' as const : phase === 'paused' ? 'paused' as const : session.state,
        };
      })();
      if (!at) return;
      // adrift: the reconnect settles the lease first, then heartbeats carry on
      if (adrift.current) { if (isOnline()) void reconcileRef.current(); return; }
      const sentAt = Date.now();
      try {
        const answer = await api<{ outcome: string; session: SessionState; server_time: number; envelope_key?: string | null }>('/playback/heartbeat', {
          method: 'POST', body: JSON.stringify({ device_id: deviceId, ...at, seq: appliedSeq.current, ...(fence.current === null ? {} : { fence: fence.current }), ...outputReport(speaker) }),
        }, workspaceId);
        learnClock(sentAt, answer.server_time);
        beatTrouble.current = false;
        if (!adrift.current) setOffline(false);
        if (answer.outcome !== 'refused') {
          leaseDeadline.current = answer.session.lease_expires_at;
          adopt(answer.session);
          learnKey(answer.envelope_key);
          if (heldVolume.current !== null) void sendHeldVolume();
        }
        if (answer.outcome === 'refused') {
          // Another device took over: the session says which, so the message can name it.
          await poll();
          becomeRemote('Playback moved to another device');
        }
      } catch (problem) {
        // the lease outlives a missed heartbeat; the next one tries again. A miss because
        // SelectaDJ can't be reached lets this device play on past the lease (cloud.offline_playback).
        beatTrouble.current = couldNotReach(problem);
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(beat);
  }, [api, becomeRemote, deviceId, poll, sendHeldVolume, speaker, workspaceId]);

  useEffect(() => () => {
    expiredSpeaker.current = false;
    speaker?.stop(0);
    speaker?.dispose?.();
    wake.current?.release();
    wakeWasHeld.current = false;
  }, [speaker]);

  /** `startAt`: where this device's first sound begins (a press on a song, a new mix from a
   * request). Without it the new speaker carries on from the session's position. */
  const playHere = useCallback(async (observedOwnerId?: string | null, startAt?: StartAt) => {
    tabLog('playHere', { deviceId: !!deviceId, speaker: !!speaker, claiming: claiming.current });
    if (!deviceId || !speaker || claiming.current) return;
    expiredSpeaker.current = false;
    claiming.current = true;
    commandRefused.current = false;
    setStarting(true); setMessage('Starting here...'); setError('');
    try {
      // the person pressed here: any other tab of this browser stops first, then this one plays
      tabLog('playHere: claiming');
      if (!(await tab.claim(true))) throw new Error('Another tab of this browser is playing. Close it, or press Play there.');
      setOtherTab(false);
      const sentAt = Date.now();
      const moved = await api<{ session: SessionState; previous_device: { name: string } | null; server_time: number; envelope_key?: string | null }>('/playback/take-over', {
        method: 'POST', body: JSON.stringify({
          device_id: deviceId, start_playing: true,
          ...(observedOwnerId === undefined ? {} : {
            require_observed_owner: true, observed_owner_id: observedOwnerId,
          }),
        }),
      }, workspaceId);
      learnClock(sentAt, moved.server_time);
      adopt(moved.session);
      learnKey(moved.envelope_key);
      if (moved.previous_device) await new Promise((resolve) => window.setTimeout(resolve, START_DELAY_MS));
      // A rapid second takeover (or a reload) can happen during the old speaker's
      // fade. Verify current ownership before producing audio: an old response does
      // not grant permission to start after a newer transfer.
      const current = await poll(true);
      if (!current || current.speaker !== 'here' || !current.session) {
        setError('Playback moved to another device or could not be verified. Check the speaker before trying again.');
        setMessage('');
        return;
      }
      // the press named a place to start: begin there, and the heartbeat tells the session
      await startSpeaking(startAt ? {
        ...current.session, song_index: startAt.song_index, offset_ms: startAt.offset_ms, anchor_at: null, state: 'playing',
      } : current.session);
      // Say where the music starts at once. Until the first regular heartbeat (up to five
      // seconds) the session still held the last speaker's place, so a remote showed this song
      // at its end.
      if (startAt) {
        void api('/playback/heartbeat', {
          method: 'POST', body: JSON.stringify({ device_id: deviceId, song_index: startAt.song_index, offset_ms: startAt.offset_ms, state: 'playing', seq: appliedSeq.current, ...(fence.current === null ? {} : { fence: fence.current }), ...outputReport(speaker) }),
        }, workspaceId).catch(() => undefined);
      }
      setMessage('');
    } catch (problem) {
      setError((problem as Error).message);
      setMessage('');
    } finally {
      claiming.current = false;
      setStarting(false);
      void poll();
    }
  }, [api, deviceId, poll, speaker, startSpeaking, tab, workspaceId]);

  /** Sends a press; true when the server took it, false when it was refused or never sent. */
  const send = useCallback(async (name: string, args?: Record<string, unknown>): Promise<boolean> => {
    // cloud.offline_playback: while SelectaDJ can't be reached, this speaker's own presses act
    // here at once; its next heartbeat after the return tells the session where the music is
    const sound = speaker ?? offlineSpeaker.current;
    const hereOffline = () => offlinePlaybackOn() && speaking.current && !!sound && LOCAL_PRESSES.has(name);
    const actHere = async () => {
      if (!sound) return false;
      const at = sound.position();
      if (name === 'pause') sound.pause();
      else if (name === 'play') sound.resume();
      else if (name === 'skip') {
        // nothing after the last song: the press does nothing rather than asking for a song that is not there
        const length = viewSnapshot.current?.session?.programme?.length;
        const next = (at?.song_index ?? 0) + 1;
        if (length === undefined || next < length) await sound.start(next, 0, true);
      }
      // a seek while paused moves the place and stays paused
      else if (name === 'seek') await sound.start(Number(args?.song_index ?? at?.song_index ?? 0), Number(args?.offset_ms ?? 0), at?.state !== 'paused');
      else if (name === 'set_volume') {
        const volume = Math.max(0, Math.min(100, Number(args?.volume ?? 100)));
        sound.setVolume?.(volume / 100);
        heldVolume.current = volume;
      }
      if (!adrift.current) beatTrouble.current = true;
      setOffline(true);
      commandRefused.current = false;
      setError('');
      return true;
    };
    if (hereOffline() && (adrift.current || !isOnline())) return actHere();
    if (!deviceId || !view?.session) return false;
    // a personal session has no shared volume (each device sets its own), so none is sent:
    // the server would refuse it, and the refusal used to be shown as why a later press failed
    if (name === 'set_volume' && typeof view.session.volume !== 'number') return false;
    try {
      const answer = await api<{ status?: string } | null>('/playback/commands', {
        method: 'POST',
        body: JSON.stringify({
          device_id: deviceId,
          command: name,
          args,
          based_on_seq: view.session.seq,
          fence: view.session.fence,
          ttl_seconds: 60,
          idempotency_key: newKey(),
        }),
      }, workspaceId);
      // Play with nobody playing is answered, not refused: say so and let the page offer a device
      if (answer?.status === 'no_speaker') {
        commandRefused.current = true;
        setError(NO_SPEAKER_WORDS);
        return false;
      }
      commandRefused.current = false;
      setError('');
      return true;
    } catch (problem) {
      if (hereOffline() && neverReached(problem)) return actHere();
      const code = (problem as { code?: string }).code;
      commandRefused.current = true;
      setError(code && RETRY_CODES.has(code) ? "Something changed just then. Here's where it is now; try again." : (problem as Error).message);
      return false;
    } finally {
      void poll();
    }
  }, [api, deviceId, poll, speaker, view?.session, workspaceId]);
  const command = useCallback(async (name: string, args?: Record<string, unknown>) => { await send(name, args); }, [send]);

  /** The speaker tells the session which songs it is playing, in order, as catalogue ids, so
   * another signed-in device can show them and steer (devices.remote_control). The session then
   * says the song at `songIndex` has just begun; this device does not jump to that (it is already
   * playing it) and its next heartbeat reports where the music really is. True when the session
   * took the programme. */
  const publishProgramme = useCallback(async (songs: readonly number[], songIndex: number): Promise<boolean> => {
    if (!deviceId || !remoteControl || !speaking.current || adrift.current || publishing.current) return false;
    if (!songs.length || songs.length > MAX_PROGRAMME) return false;
    publishing.current = true;
    // where the music is by the engine's own account, when it can say; else what the caller saw
    const at = speaker?.position()?.song_index ?? songIndex;
    try {
      const post = (session: SessionState) => api<{ status: string; applied_seq: number | null }>('/playback/commands', {
        method: 'POST',
        body: JSON.stringify({
          device_id: deviceId, command: 'set_programme',
          args: { songs, song_index: Math.max(0, Math.min(songs.length - 1, Math.round(at))) },
          based_on_seq: session.seq, fence: session.fence, ttl_seconds: 60, idempotency_key: newKey(),
        }),
      }, workspaceId);
      let session = viewSnapshot.current?.session ?? null;
      for (let attempt = 0; attempt < 2 && session; attempt += 1) {
        try {
          const answer = await post(session);
          if (typeof answer.applied_seq === 'number') appliedSeq.current = Math.max(appliedSeq.current, answer.applied_seq);
          return answer.status === 'applied';
        } catch (problem) {
          // the session moved on between the read and the press: read it again and try once more
          if (!RETRY_CODES.has((problem as { code?: string }).code ?? '')) return false;
          const fresh = await poll(true);
          session = fresh?.speaker === 'here' ? fresh.session : null;
        }
      }
      return false;
    } finally {
      publishing.current = false;
    }
  }, [api, deviceId, poll, remoteControl, speaker, workspaceId]);

  /** cloud.offline_playback: start this device's own files with no connection. There is no lease
   * to take, so the device plays "adrift" and settles with the server when the connection is
   * back: it keeps playing if no other device holds a live lease, and stops here if one does.
   * `using` is a speaker made by the same press, before it reaches this hook as a prop. */
  const playOffline = useCallback(async (songIndex: number, offsetMs: number, using?: Speaker | null): Promise<boolean> => {
    const sound = using ?? speaker;
    if (!offlinePlaybackOn() || !sound || isOnline()) return false;
    speaking.current = true;
    adrift.current = true;
    expiredSpeaker.current = false;
    leaseDeadline.current = null;
    setOffline(true);
    setOfflineNotice('');
    setMessage('');
    setError('');
    offlineSpeaker.current = sound;
    if (!wake.current) wake.current = holdWakeLock();
    wakeWasHeld.current = false;
    await sound.start(songIndex, offsetMs, true);
    return true;
  }, [speaker]);

  // ADR-0461: the speaker checks each delivered command against its own fence and the server's
  // clock, carries it out by following the session, then acks what it actually did. A command
  // for another device, an expired or superseded one, or one heard while not the speaker is
  // never acked: the server records its own verdict for those.
  const handleCommand = useCallback(async (raw: CommandEvent): Promise<AckResult | null> => {
    if (!deviceId || !speaker || !remoteControl || raw.device_id !== deviceId) return null;
    if (!speaking.current || acked.current.has(raw.command_id)) return null;
    // A forged, mis-scoped or tampered envelope is never acted on and never acked.
    const event = await openEnvelope(raw, envelopeKey.current, workspaceId, deviceId);
    if (!event) return null;
    if (!commandStillValid(event, fence.current, serverNow())) return null;
    let result: AckResult = 'unavailable_here';
    let songId: number | null = null;
    if (event.command === 'set_volume' && typeof speaker.setVolume !== 'function') {
      result = 'unavailable_here';
    } else if (SPEAKER_COMMANDS.has(event.command)) {
      const now = await poll(true);
      // Applied only when this device is still the speaker and has followed the session to (or
      // past) the command; otherwise it says it could not, never that it did.
      if (!now || now.speaker !== 'here' || !now.session || !speaking.current) return null;
      if (now.session.seq >= event.seq) {
        for (let waited = 0; publishing.current && waited < 20; waited += 1) await new Promise((resolve) => window.setTimeout(resolve, 100));
        await follow(now.session);
        if (appliedSeq.current >= event.seq) result = 'applied';
        // Moved to a track this device could not resolve (ADR-0458): say so, naming it, so
        // controllers can offer alternatives instead of a silent skip.
        if (result === 'applied' && MOVES_TRACK.has(event.command) && now.session.state !== 'stopped' && !speaker.position()) {
          result = 'unavailable_here';
          songId = now.session.track?.song_id ?? null;
        }
      }
    }
    acked.current.add(event.command_id);
    try {
      const ackPath = event.zone_id
        ? `/zones/${encodeURIComponent(event.zone_id)}/playback/commands/${encodeURIComponent(event.command_id)}/ack`
        : `/playback/commands/${encodeURIComponent(event.command_id)}/ack`;
      await api(ackPath, {
        method: 'POST', body: JSON.stringify({
          device_id: deviceId, result,
          ...(event.signature ? { signature: event.signature } : {}),
          ...(songId === null ? {} : { song_id: songId }),
        }),
      }, workspaceId);
    } catch {
      // A lost ack is retried on the next delivery of the same id; the server replays the first.
      acked.current.delete(event.command_id);
    }
    return result;
  }, [api, deviceId, follow, poll, remoteControl, speaker, workspaceId]);

  useEffect(() => {
    const hear = (event: Event) => { void handleCommand((event as CustomEvent<CommandEvent>).detail); };
    window.addEventListener(PLAYBACK_COMMAND_EVENT, hear);
    return () => window.removeEventListener(PLAYBACK_COMMAND_EVENT, hear);
  }, [handleCommand]);

  return { device, notice, view, message, starting, error, playHere, publishProgramme, handleCommand, knownFence: () => fence.current, refreshSession: () => poll(true), command, send, serverNow, isSpeaker: () => speaking.current,
    /** cloud.offline_playback: playing on while SelectaDJ can't be reached, and what was said when that ended. */
    offline, offlineNotice, playOffline, heldVolume: () => heldVolume.current,
    /** ADR-0475 F: another tab of this browser is making the sound. */
    otherTab };
}
