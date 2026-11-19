import { useCallback, useEffect, useRef, useState } from 'react';
import { audioSpeaker } from './audioSpeaker';
import { browserName, capabilities, currentFacts, deviceKind } from './deviceInfo';
import { Api, extrapolate, FADE_MS, HEARTBEAT_MS, Speaker } from './usePlaybackDevice';
import { holdWakeLock, WakeLockHold } from './wakeLock';
import { toZoneError, zonePlayback, type ZoneSessionState } from './zonePlayback';

// "Play here" for a business zone (ADR-0443 BZ-0443-05): a staff member's browser becomes the
// zone's speaker. It registers as a device in the organisation, takes the zone lease (asking
// first when a kiosk is playing: the server answers `confirm_needed`), plays the zone's
// programme from `/business/zones/{zone}/speaker/...`, heartbeats every 5 s with the fence it
// was given, stops the moment the server says someone else holds the lease (or the lease runs
// out without a renewal), and hands back at the person's word with where the music is.
// While it holds the lease the server refuses personal playback on this browser.

export type ZoneSpeakerPhase = 'idle' | 'confirm' | 'starting' | 'speaking';
export type Segment = { key: string; song_index: number; title?: string; artist?: string };
type SpeakerFor = (audio: HTMLAudioElement, source: (index: number) => Promise<string | null>) => Speaker;

const enc = encodeURIComponent;
export const SPEAKER_ROUTES = {
  horizon: (zone: string) => `/business/zones/${enc(zone)}/speaker/horizon`,
  segment: (zone: string) => `/business/zones/${enc(zone)}/speaker/segment-url`,
} as const;

const storedKey = (workspaceId: string) => `selecta.device.${workspaceId}`;
function stored(workspaceId: string): string | null {
  try { return localStorage.getItem(storedKey(workspaceId)); } catch { return null; }
}
function remember(workspaceId: string, id: string) {
  try { localStorage.setItem(storedKey(workspaceId), id); } catch { /* the cookie still names it */ }
}

/** Where the session says the music is, for a heartbeat when the speaker can't say. */
function positionOf(speaker: Speaker | null, session: ZoneSessionState, serverNow: number) {
  const here = speaker?.position();
  if (here) return { song_index: here.song_index, offset_ms: Math.max(0, Math.round(here.offset_ms)), state: here.state };
  return { song_index: session.song_index, offset_ms: extrapolate(session, serverNow), state: session.state === 'playing' ? 'playing' as const : 'paused' as const };
}

export function useZoneSpeaker({ api, workspaceId, zoneId, zoneName, speakerFor = audioSpeaker }: {
  api: Api; workspaceId: string; zoneId: string; zoneName: string; speakerFor?: SpeakerFor;
}) {
  const [phase, setPhase] = useState<ZoneSpeakerPhase>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [handBackOffered, setHandBackOffered] = useState(false);
  const calls = useRef(zonePlayback(api, workspaceId));
  calls.current = zonePlayback(api, workspaceId);
  const device = useRef<string | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const session = useRef<ZoneSessionState | null>(null);
  const fence = useRef<number | undefined>(undefined);
  const offset = useRef(0);
  const segments = useRef<Segment[]>([]);
  const wake = useRef<WakeLockHold | null>(null);
  const speaking = useRef(false);

  const serverNow = () => Date.now() / 1000 + offset.current;
  const learnClock = (sentAt: number, serverTime: number) => { offset.current = serverTime - (sentAt + Date.now()) / 2000; };

  const register = useCallback(async (): Promise<string> => {
    if (device.current) return device.current;
    const facts = currentFacts();
    const made = await api<{ device: { id: string } }>('/devices', {
      method: 'POST',
      body: JSON.stringify({ device_id: stored(workspaceId), name: browserName(facts), kind: deviceKind(facts), capabilities: capabilities(facts) }),
    }, workspaceId);
    remember(workspaceId, made.device.id);
    device.current = made.device.id;
    return made.device.id;
  }, [api, workspaceId]);

  const loadHorizon = useCallback(async () => {
    const answer = await api<{ segments: Segment[] }>(SPEAKER_ROUTES.horizon(zoneId), {}, workspaceId);
    segments.current = answer?.segments ?? [];
  }, [api, workspaceId, zoneId]);

  const source = useCallback(async (index: number): Promise<string | null> => {
    let found = segments.current.find((item) => item.song_index === index);
    if (!found) { await loadHorizon().catch(() => undefined); found = segments.current.find((item) => item.song_index === index); }
    if (!found) return null;
    const answer = await api<{ url: string }>(SPEAKER_ROUTES.segment(zoneId), { method: 'POST', body: JSON.stringify({ key: found.key }) }, workspaceId);
    return answer?.url ?? null;
  }, [api, loadHorizon, workspaceId, zoneId]);

  const stop = useCallback((why: string, fadeMs = FADE_MS) => {
    speaking.current = false;
    speaker.current?.stop(fadeMs);
    wake.current?.release();
    wake.current = null;
    session.current = null;
    setHandBackOffered(false);
    setPhase('idle');
    setMessage(why);
  }, []);

  const playHere = useCallback(async (confirm = false): Promise<'speaking' | 'confirm' | 'failed'> => {
    setError(''); setMessage(''); setPhase('starting');
    try {
      const id = await register();
      const sentAt = Date.now();
      const moved = await calls.current.takeOver(zoneId, id, { startPlaying: true, confirm });
      learnClock(sentAt, moved.server_time);
      session.current = moved.session;
      fence.current = moved.session.fence;
      await loadHorizon();
      if (!speaker.current) speaker.current = speakerFor(new Audio(), source);
      if (typeof moved.session.volume === 'number') speaker.current.setVolume?.(Math.min(1, Math.max(0, moved.session.volume / 100)));
      wake.current = wake.current ?? holdWakeLock();
      speaking.current = true;
      await speaker.current.start(moved.session.song_index, extrapolate(moved.session, serverNow()), moved.session.state === 'playing');
      setPhase('speaking');
      setMessage(`Playing ${zoneName} here`);
      return 'speaking';
    } catch (problem) {
      const refused = toZoneError(problem);
      if (refused.code === 'confirm_needed') { setPhase('confirm'); return 'confirm'; }
      speaking.current = false;
      setPhase('idle');
      setError(refused.message);
      return 'failed';
    }
  }, [loadHorizon, register, source, speakerFor, zoneId, zoneName]);

  const handBack = useCallback(async () => {
    const id = device.current;
    const now = session.current;
    if (!id || !now) { stop(''); return; }
    const at = positionOf(speaker.current, now, serverNow());
    try {
      await calls.current.handBack(zoneId, id, at.song_index, at.offset_ms);
      stop(`${zoneName} handed back`);
    } catch (problem) {
      setError(toZoneError(problem).message);
    }
  }, [stop, zoneId, zoneName]);

  useEffect(() => {
    if (phase !== 'speaking') return;
    const beat = window.setInterval(async () => {
      const id = device.current;
      const now = session.current;
      if (!speaking.current || !id || !now) return;
      if (now.lease_expires_at !== null && serverNow() >= now.lease_expires_at + HEARTBEAT_MS / 1000) {
        stop('Playback stopped because this browser could not renew the zone lease.', 0);
        return;
      }
      const at = positionOf(speaker.current, now, serverNow());
      const sentAt = Date.now();
      try {
        const answer = await calls.current.heartbeat(zoneId, { device_id: id, ...at, seq: now.seq, ...(fence.current === undefined ? {} : { fence: fence.current }) });
        learnClock(sentAt, answer.server_time);
        if (answer.outcome === 'refused' || answer.session.active_device_id !== id) {
          stop(`${zoneName} is playing on another device now.`);
          return;
        }
        session.current = answer.session;
        if (typeof answer.session.fence === 'number') fence.current = answer.session.fence;
        setHandBackOffered(Boolean(answer.hand_back_to_device_id && answer.hand_back_to_device_id !== id));
      } catch (problem) {
        const refused = toZoneError(problem);
        if (refused.status === 403 || refused.status === 404) stop(`${zoneName} stopped playing here.`, 0);
        // any other failure: the lease outlives one missed heartbeat; the next one tries again
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(beat);
  }, [phase, stop, zoneId, zoneName]);

  // Leaving the page while speaking gives the zone back rather than leaving it to lapse.
  const handBackRef = useRef(handBack);
  handBackRef.current = handBack;
  useEffect(() => () => {
    if (speaking.current) void handBackRef.current();
    speaker.current?.dispose?.();
  }, []);

  return {
    phase, message, error, handBackOffered,
    playHere, handBack,
    cancel: () => { setPhase('idle'); },
    deviceId: () => device.current,
  };
}
