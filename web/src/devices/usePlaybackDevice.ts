import { useCallback, useEffect, useRef, useState } from 'react';
import { browserName, capabilities, currentFacts, deviceKind } from './deviceInfo';
import { holdWakeLock, WakeLockHold } from './wakeLock';

// This browser as a playback device, and the account's one playback session (ADR-0415).
//
// - The device registers once per workspace and keeps its id in local storage.
// - While it's the speaker it heartbeats every 5 s and checks the session every second, so when
//   another device takes over it hears within a second and fades out over one.
// - "Play here" takes the lease, says "Starting here...", and waits long enough for the old
//   speaker to have heard and faded before it starts: a short gap, never two speakers at once.
// - A remote's buttons send commands with the sequence they were based on and a fresh
//   idempotency key; a stale press redraws from the server and asks to try again.

export type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
export type Warning = { code: string; text: string };
export type Device = { id: string; name: string; kind: string; signed_in: boolean; this_device: boolean; poor_speaker: boolean; last_seen_at: number; warnings: Warning[] };
/** A programme entry as an ADR-0458 identity: resolved locally on the speaker, never a path. */
export type ProgrammeRef = { song_id: number; sha256: string };
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
  state?(): { output: { status: string; at?: number } };
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
  const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  // A refused press explains itself; the follow-up poll must not wipe that answer.
  const commandRefused = useRef(false);
  const clockOffset = useRef(0);
  // A slow poll must never overwrite a newer ownership decision.
  const latestPoll = useRef(0);
  // Never let cached/buffered audio outlive the server-issued exclusive lease.
  const leaseDeadline = useRef<number | null>(null);
  // Expiry silences cached audio, but reconnect may resume if the server still owns it.
  const expiredSpeaker = useRef(false);
  const recoveringExpired = useRef(false);
  const claiming = useRef(false);
  const speaking = useRef(false);
  const appliedSeq = useRef(-1);
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
  const deviceId = device?.id ?? null;

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
    }).catch((problem: Error) => { if (current) setError(problem.message); });
    return () => { current = false; };
  }, [api, workspaceId]);

  const serverNow = () => Date.now() / 1000 + clockOffset.current;

  const learnClock = (sentAt: number, serverTime: number) => {
    const midpoint = (sentAt + Date.now()) / 2000;
    clockOffset.current = serverTime - midpoint;
  };

  const becomeRemote = useCallback((why: string, fadeMs = FADE_MS) => {
    if (!speaking.current) return;
    speaking.current = false;
    envelopeKey.current = null;
    leaseDeadline.current = null;
    expiredSpeaker.current = false;
    speaker?.stop(fadeMs);
    wake.current?.release();
    wake.current = null;
    setMessage(why);
  }, [speaker]);

  const startSpeaking = useCallback(async (session: SessionState) => {
    if (!speaker) return;
    speaking.current = true;
    expiredSpeaker.current = false;
    adopt(session);
    leaseDeadline.current = session.lease_expires_at;
    appliedSeq.current = session.seq;
    if (!wake.current) wake.current = holdWakeLock();
    if (typeof session.volume === 'number') speaker.setVolume?.(Math.min(1, Math.max(0, session.volume / 100)));
    await speaker.start(session.song_index, extrapolate(session, serverNow()), session.state === 'playing');
  }, [speaker]);

  /** Follow a session this device is the speaker of: play, pause, skip and seek from remotes. */
  const follow = useCallback(async (session: SessionState) => {
    if (!speaker || session.seq <= appliedSeq.current) return;
    appliedSeq.current = session.seq;
    if (!remoteControl) return;
    if (typeof session.volume === 'number') speaker.setVolume?.(Math.min(1, Math.max(0, session.volume / 100)));
    const here = speaker.position();
    const target = extrapolate(session, serverNow());
    const moved = !here || here.song_index !== session.song_index || Math.abs(here.offset_ms - target) > 2500;
    if (moved) await speaker.start(session.song_index, target, session.state === 'playing');
    else if (session.state === 'paused' && speaker.active()) speaker.pause();
    else if (session.state === 'playing' && !speaker.active()) speaker.resume();
  }, [speaker, remoteControl]);

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
  }, [api, deviceId, speaker, startSpeaking, workspaceId]);

  const poll = useCallback(async (forDecision = false): Promise<SessionView | null> => {
    if (!deviceId) return null;
    const requestId = ++latestPoll.current;
    const sentAt = Date.now();
    try {
      const next = await api<SessionView>(`/playback/session?device_id=${encodeURIComponent(deviceId)}`, {}, workspaceId);
      // A reconnect/background poll can start after a person's button press. It must not
      // discard that button's authoritative answer: the UI still needs to ask before
      // taking an existing lease. Only the most recent response changes shared state.
      if (requestId !== latestPoll.current) return forDecision ? next : null;
      learnClock(sentAt, next.server_time);
      adopt(next.session);
      if (next.speaker === 'here') learnKey(next.envelope_key);
      setView(next);
      if (!commandRefused.current) setError('');
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
      setError((problem as Error).message);
      return null;
    }
  }, [api, becomeRemote, deviceId, follow, recoverExpired, workspaceId]);

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
        if (verified?.speaker === 'here' && verified.session) {
          await startSpeaking(verified.session);
        } else if (!verified) {
          // Reconnect succeeded but verification could not reach the server.
          // Keep quiet and retry only after a later successful session poll.
          expiredSpeaker.current = true;
        }
      }
    }).catch(() => undefined).finally(() => { if (current) void poll(); });
    return () => { current = false; };
  }, [api, deviceId, poll, speaker, startSpeaking, workspaceId]);

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
      if (speaking.current && leaseDeadline.current !== null && serverNow() >= leaseDeadline.current) {
        becomeRemote('Playback stopped because this device could not renew its audio lease.', 0);
        expiredSpeaker.current = true;
      }
    }, SPEAKER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [becomeRemote, deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    const beat = window.setInterval(async () => {
      if (!speaking.current || !speaker) return;
      const at = speaker.position();
      if (!at) return;
      const sentAt = Date.now();
      try {
        const answer = await api<{ outcome: string; session: SessionState; server_time: number; envelope_key?: string | null }>('/playback/heartbeat', {
          method: 'POST', body: JSON.stringify({ device_id: deviceId, ...at, seq: appliedSeq.current, ...(fence.current === null ? {} : { fence: fence.current }), ...outputReport(speaker) }),
        }, workspaceId);
        learnClock(sentAt, answer.server_time);
        if (answer.outcome !== 'refused') {
          leaseDeadline.current = answer.session.lease_expires_at;
          adopt(answer.session);
          learnKey(answer.envelope_key);
        }
        if (answer.outcome === 'refused') {
          // Another device took over: the session says which, so the message can name it.
          await poll();
          becomeRemote('Playback moved to another device');
        }
      } catch { /* the lease outlives a missed heartbeat; the next one tries again */ }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(beat);
  }, [api, becomeRemote, deviceId, poll, speaker, workspaceId]);

  useEffect(() => () => {
    expiredSpeaker.current = false;
    speaker?.stop(0);
    speaker?.dispose?.();
    wake.current?.release();
  }, [speaker]);

  const playHere = useCallback(async (observedOwnerId?: string | null) => {
    if (!deviceId || !speaker || claiming.current) return;
    expiredSpeaker.current = false;
    claiming.current = true;
    commandRefused.current = false;
    setStarting(true); setMessage('Starting here...'); setError('');
    try {
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
      await startSpeaking(current.session);
      setMessage('');
    } catch (problem) {
      setError((problem as Error).message);
      setMessage('');
    } finally {
      claiming.current = false;
      setStarting(false);
      void poll();
    }
  }, [api, deviceId, poll, speaker, startSpeaking, workspaceId]);

  /** Sends a press; true when the server took it, false when it was refused or never sent. */
  const send = useCallback(async (name: string, args?: Record<string, unknown>): Promise<boolean> => {
    if (!deviceId || !view?.session) return false;
    try {
      await api('/playback/commands', {
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
      commandRefused.current = false;
      setError('');
      return true;
    } catch (problem) {
      const code = (problem as { code?: string }).code;
      commandRefused.current = true;
      setError(code && RETRY_CODES.has(code) ? "Something changed just then. Here's where it is now; try again." : (problem as Error).message);
      return false;
    } finally {
      void poll();
    }
  }, [api, deviceId, poll, view?.session, workspaceId]);
  const command = useCallback(async (name: string, args?: Record<string, unknown>) => { await send(name, args); }, [send]);

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

  return { device, notice, view, message, starting, error, playHere, handleCommand, knownFence: () => fence.current, refreshSession: () => poll(true), command, send, serverNow, isSpeaker: () => speaking.current };
}
