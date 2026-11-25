import { useEffect, useRef } from 'react';
import { pickCandidates, type CrowdMark, type MeasuredPair } from './roundCandidates';

// The speaker's part in "Pick the next song" (ADR-0488, flag `rooms.rounds`).
//
// The device that is playing the mix is the planner, so it is the one that offers the songs
// and asks for the result:
//
// - when the room wants a vote (the host pressed "Let the room pick" on any device, or the
//   host's "every N songs" came round), this browser picks up to three songs it can play that
//   are not in the mix and opens the vote with them;
// - when a vote's time is up, it asks the server for the result. The winner then arrives in the
//   Requests list like any accepted request, marked to be added without a tap, and the list's
//   own loop puts it after the song that is playing.
//
// A device that is not the speaker does nothing here. If the speaker is away the vote still
// closes: the next phone to read the room closes it, and the winner waits in Requests.

/** CloudApp dispatches this on `window` for each `room.round` event on the workspace stream. */
export const ROOM_ROUND_EVENT = 'selecta:room-round';

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
type Send = <T>(path: string, init?: RequestInit) => Promise<T>;
type Playing = { mix: readonly { song_id: number }[]; player: { state: { phase: string; position: number } } };
type RoundEvent = { room_id?: string; round_id?: string; state?: string; opened_by?: string };
type PulseRound = { round_id: string; state: string; closes_at: number };
type Pulse = { now: number; round?: PulseRound | null };

export function useRoomRounds({ api, workspaceId, roomId, enabled, isSpeaker, playing, request }: {
  api: Api;
  workspaceId: string;
  /** The open room, if there is one. */
  roomId: string | undefined;
  /** `rooms.rounds` is on for this account. */
  enabled: boolean;
  isSpeaker: () => boolean;
  playing: { current: Playing };
  /** The browser's own adapted request, for the songs it can play and the pairs it has measured. */
  request: Send;
}): void {
  const speaker = useRef(isSpeaker);
  speaker.current = isSpeaker;

  useEffect(() => {
    if (!enabled || !roomId) return undefined;
    let live = true;
    let closing = 0;
    const base = `/rooms/${encodeURIComponent(roomId)}`;

    const offer = async (openedBy: string) => {
      const { mix, player } = playing.current;
      if (!speaker.current() || player.state.phase !== 'playing' || !mix.length) return;
      const from = mix[Math.min(Math.max(0, player.state.position), mix.length - 1)]?.song_id ?? null;
      const [pool, pairs, marks] = await Promise.all([
        request<{ songs: { song_id: number; artist?: string }[] }>('/mix/suggest?limit=400').then((answer) => answer.songs, () => []),
        request<MeasuredPair[]>('/discoveries').catch(() => [] as MeasuredPair[]),
        api<{ marks: CrowdMark[] }>('/crowd-marks', {}, workspaceId).then((answer) => answer.marks, () => [] as CrowdMark[]),
      ]);
      const songIds = pickCandidates({ pool, from, pairs, marks });
      if (!live || songIds.length < 2) return;
      // refused when another device beat this one to it, or the songs can't be played: either
      // way the room's pulse says what stands
      await api(`${base}/rounds`, { method: 'POST', body: JSON.stringify({ song_ids: songIds, opened_by: openedBy === 'timer' ? 'timer' : 'host' }) }, workspaceId).catch(() => undefined);
    };

    const watch = async () => {
      if (!speaker.current()) return;
      const pulse = await api<Pulse>(`${base}/pulse`, {}, workspaceId).catch(() => null);
      const round = pulse?.round;
      window.clearTimeout(closing);
      if (!live || !pulse || !round || round.state !== 'open') return;
      closing = window.setTimeout(() => {
        void api(`${base}/rounds/${encodeURIComponent(round.round_id)}/close`, { method: 'POST' }, workspaceId).catch(() => undefined);
      }, Math.max(0, (round.closes_at - pulse.now) * 1000) + 400);
    };

    const heard = (event: Event) => {
      const detail = (event as CustomEvent<RoundEvent>).detail ?? {};
      if (detail.room_id && detail.room_id !== roomId) return;
      if (detail.state === 'wanted') void offer(detail.opened_by ?? 'host');
      else if (detail.state === 'open') void watch();
    };
    window.addEventListener(ROOM_ROUND_EVENT, heard);
    // a vote already open when this page loaded still gets its result asked for
    void watch();
    return () => {
      live = false;
      window.clearTimeout(closing);
      window.removeEventListener(ROOM_ROUND_EVENT, heard);
    };
  }, [api, workspaceId, roomId, enabled, request]);
}
