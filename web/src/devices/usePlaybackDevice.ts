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
export type SessionState = { mix_revision_id: string | null; song_index: number; offset_ms: number; anchor_at: number | null; state: 'playing' | 'paused' | 'stopped'; active_device_id: string | null; lease_expires_at: number | null; seq: number };
export type SessionView = { session: SessionState | null; speaker: 'here' | 'elsewhere' | 'offline' | 'none'; speaker_device_id: string | null; speaker_name: string | null; ask_before_playing_here: boolean; server_time: number };
export type Position = { song_index: number; offset_ms: number; state: 'playing' | 'paused' };

/** What actually makes sound on this device. */
export interface Speaker {
  start(songIndex: number, offsetMs: number, playing: boolean): Promise<void>;
  stop(fadeMs: number): void;
  pause(): void;
  resume(): void;
  position(): Position | null;
  active(): boolean;
  /** Release listeners and locally cached audio when the device UI unmounts. */
  dispose?(): void;
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
    leaseDeadline.current = session.lease_expires_at;
    appliedSeq.current = session.seq;
    if (!wake.current) wake.current = holdWakeLock();
    await speaker.start(session.song_index, extrapolate(session, serverNow()), session.state === 'playing');
  }, [speaker]);

  /** Follow a session this device is the speaker of: play, pause, skip and seek from remotes. */
  const follow = useCallback(async (session: SessionState) => {
    if (!speaker || session.seq <= appliedSeq.current) return;
    appliedSeq.current = session.seq;
    if (!remoteControl) return;
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
      const answer = await api<{ action: string; session: SessionState | null; message: string | null }>(
        '/playback/reconnect',
        { method: 'POST', body: JSON.stringify({ device_id: deviceId }) },
        workspaceId,
      );
      if (!expiredSpeaker.current) return;
      expiredSpeaker.current = false;
      if (answer.action === 'continue' && answer.session) {
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
      setView(next);
      setError('');
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
    api<{ action: string; session: SessionState | null; message: string | null }>('/playback/reconnect', {
      method: 'POST', body: JSON.stringify({ device_id: deviceId }),
    }, workspaceId).then(async (answer) => {
      if (current && answer.action === 'continue' && answer.session) await startSpeaking(answer.session);
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
        const answer = await api<{ outcome: string; session: SessionState; server_time: number }>('/playback/heartbeat', {
          method: 'POST', body: JSON.stringify({ device_id: deviceId, ...at, seq: appliedSeq.current }),
        }, workspaceId);
        learnClock(sentAt, answer.server_time);
        if (answer.outcome !== 'refused') leaseDeadline.current = answer.session.lease_expires_at;
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
    setStarting(true); setMessage('Starting here...'); setError('');
    try {
      const sentAt = Date.now();
      const moved = await api<{ session: SessionState; previous_device: { name: string } | null; server_time: number }>('/playback/take-over', {
        method: 'POST', body: JSON.stringify({
          device_id: deviceId, start_playing: true,
          ...(observedOwnerId === undefined ? {} : {
            require_observed_owner: true, observed_owner_id: observedOwnerId,
          }),
        }),
      }, workspaceId);
      learnClock(sentAt, moved.server_time);
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

  const command = useCallback(async (name: string, args?: Record<string, unknown>) => {
    if (!deviceId || !view?.session) return;
    try {
      await api('/playback/commands', {
        method: 'POST',
        body: JSON.stringify({ device_id: deviceId, command: name, args, based_on_seq: view.session.seq, idempotency_key: newKey() }),
      }, workspaceId);
      setError('');
    } catch (problem) {
      const code = (problem as { code?: string }).code;
      setError(code === 'stale_command' ? "Something changed just then. Here's where it is now; try again." : (problem as Error).message);
    } finally {
      void poll();
    }
  }, [api, deviceId, poll, view?.session, workspaceId]);

  return { device, notice, view, message, starting, error, playHere, refreshSession: () => poll(true), command, serverNow, isSpeaker: () => speaking.current };
}
