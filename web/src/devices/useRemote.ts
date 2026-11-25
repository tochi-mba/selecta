import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixItem } from '../api';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { OPTIMISTIC_MS } from './PlayingBar';
import { bookOf, entryAt, hasNext, previousTarget, remotePosition, remoteSession, sameProgramme, whereWords, type RemoteEntry, type RemoteSession, type SongBook, type SongDetails } from './remoteNow';
import { levelOf, type SessionView } from './usePlaybackDevice';
import { asConfirmed, type Unconfirmed } from './pressConfirm';

// The remote session as the shell and the Listen page use it (flag `devices.remote_control`).
//
// A device that is not the speaker, and whose own mix is not what is playing, steers the speaker
// through the playback hook's commands. Two things read this hook:
// - RemoteListen.tsx, the Listen page of a controller;
// - the shell's mini player, through `player`, `now` and `song`: the remote session presented
//   through the same PlayerLike and NowState contract the local player satisfies, so the existing
//   mini transport and its styles are used as they are, with every press sent as a command.
// With the flag off, or on the speaker itself, the hook answers null and nothing changes.

/** What this hook needs from usePlaybackDevice. */
export type RemoteDevice = {
  view: SessionView | null;
  send: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  /** The session state the last press made (its seq); 0 when unknown. */
  sentSeq?: () => number;
  serverNow: () => number;
  /** G3 (68): a press waiting on the speaker, and one it did not carry out in time. */
  pending?: Unconfirmed | null;
  unconfirmed?: Unconfirmed | null;
};

export type Remote = {
  view: SessionView;
  session: RemoteSession;
  book: SongBook;
  current: RemoteEntry;
  /** What the play button shows: the last press until the speaker answers, else what it reports. */
  playing: boolean;
  positionMs: () => number;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seekTo: (songIndex: number, offsetMs: number) => Promise<void>;
  skipTo: (songIndex: number) => Promise<void>;
  setVolume: (percent: number) => Promise<void>;
  /** G2 (57): end the music on the speaker and free it (not a pause). */
  stop: () => Promise<boolean>;
  /** G2 (56): the songs after the playing one, in a new order (moved, removed or cleared). */
  setUpNext: (songIds: readonly number[]) => Promise<boolean>;
  /** The session state the last press made. */
  sentSeq: () => number;
  /** The same session through the shell's player contract, for the mini player. */
  player: PlayerLike;
  now: NowState;
  song: MixItem;
  hasNext: boolean;
  /** G3: the press waiting on the speaker to carry it out, if any. */
  pending: string | null;
};

/** How long an unknown song waits before the library is read again for it. */
const REREAD_AFTER_MS = 30_000;
/** The mini player's volume slider moves many times in one drag: the last value is sent once. */
const VOLUME_SETTLE_MS = 300;

export function useRemote({ remoteControl, device, mixSongIds, loadSongs }: {
  remoteControl: boolean;
  device: RemoteDevice;
  /** This device's own mix, by song id: when it is the programme, the ordinary Listen follows it. */
  mixSongIds: readonly number[];
  /** The account's library rows (title, artist, length); read once a remote is needed. */
  loadSongs: () => Promise<readonly ({ id: number } & SongDetails)[]>;
}): Remote | null {
  const view = device.view;
  const seen = remoteSession(view, remoteControl);
  // G3 (68): a press the speaker did not carry out is not shown as if it had been
  // ...nor, while it waits on the speaker, as done before the speaker has done it (G3, 55)
  const found = useMemo(() => (seen ? asConfirmed(seen, device.unconfirmed ?? device.pending ?? null) : null), [seen, device.unconfirmed, device.pending]);
  const session = found && !sameProgramme(found.programme, mixSongIds) ? found : null;
  const active = session !== null;

  // Song details, read when a remote first needs them and again (at most every half minute)
  // while the programme names a song the last read did not have.
  const [book, setBook] = useState<SongBook>(() => new Map());
  const readAt = useRef(0);
  const [failed, setFailed] = useState(0);
  const load = useRef(loadSongs);
  load.current = loadSongs;
  const missing = session ? session.programme.some((entry) => !book.has(entry.song_id)) : false;
  useEffect(() => {
    if (!active || !missing) return undefined;
    let gone = false;
    const read = () => {
      readAt.current = Date.now();
      // a read that failed is tried again after the same wait; until then songs show by number
      void load.current().then((songs) => { if (!gone) setBook(bookOf(songs)); }, () => { if (!gone) setFailed((count) => count + 1); });
    };
    const wait = Math.max(0, readAt.current ? readAt.current + REREAD_AFTER_MS - Date.now() : 0);
    const timer = window.setTimeout(read, wait);
    return () => { gone = true; window.clearTimeout(timer); };
  }, [active, missing, book, failed]);

  // The press shows at once, tied to the session seq it was based on; a newer seq replaces it,
  // a refusal takes it back, and a press the speaker never applies lapses (as the playing bar's).
  const [wanted, setWanted] = useState<{ playing: boolean; seq: number } | null>(null);
  useEffect(() => { if (wanted && session && session.seq !== wanted.seq) setWanted(null); }, [session, wanted]);
  useEffect(() => {
    if (!wanted) return undefined;
    const timer = window.setTimeout(() => setWanted((held) => (held === wanted ? null : held)), OPTIMISTIC_MS);
    return () => window.clearTimeout(timer);
  }, [wanted]);

  const latest = useRef({ view, session, book, device });
  latest.current = { view, session, book, device };
  const durationOf = (at: RemoteSession, songs: SongBook) => entryAt(at, songs, at.song_index)?.durationMs ?? null;
  const positionMs = useCallback(() => {
    const { view: seen, session: at, book: songs, device: hook } = latest.current;
    return seen && at ? remotePosition(seen, at, hook.serverNow(), durationOf(at, songs)) : 0;
  }, []);
  const send = useCallback((name: string, args?: Record<string, unknown>) => latest.current.device.send(name, args), []);

  const reported = session?.state === 'playing';
  const playing = wanted && session && wanted.seq === session.seq ? wanted.playing : reported;
  const playingNow = useRef(playing);
  playingNow.current = playing;

  const toggle = useCallback(async () => {
    const at = latest.current.session;
    if (!at) return;
    const play = !playingNow.current;
    // with the speaker checking in, the press shows once it confirms (G3); a press held for an
    // offline speaker shows at once and lapses as before
    const held = latest.current.view?.speaker !== 'elsewhere';
    if (held) setWanted({ playing: play, seq: at.seq });
    if (!(await send(play ? 'play' : 'pause')) && held) setWanted(null);
  }, [send]);
  const next = useCallback(async () => {
    const at = latest.current.session;
    if (at && hasNext(at)) await send('skip');
  }, [send]);
  const seekTo = useCallback(async (songIndex: number, offsetMs: number) => {
    await send('seek', { song_index: songIndex, offset_ms: Math.max(0, Math.round(offsetMs)) });
  }, [send]);
  const previous = useCallback(async () => {
    const at = latest.current.session;
    if (!at) return;
    const target = previousTarget(at, positionMs());
    await seekTo(target.song_index, target.offset_ms);
  }, [positionMs, seekTo]);
  const skipTo = useCallback(async (songIndex: number) => { await send('skip', { song_index: songIndex }); }, [send]);
  const setVolume = useCallback(async (percent: number) => {
    // ADR-0475 G1: every session carries a mix level the speaker plays at
    await send('set_volume', { volume: Math.max(0, Math.min(100, Math.round(percent))) });
  }, [send]);

  const stop = useCallback(() => send('stop'), [send]);
  const setUpNext = useCallback(async (songIds: readonly number[]) => {
    const at = latest.current.session;
    if (!at) return false;
    // the songs up to and with the playing one stay as they are; the music does not move
    const kept = at.programme.slice(0, at.song_index + 1).map((entry) => entry.song_id);
    return send('set_programme', { songs: [...kept, ...songIds], song_index: at.song_index, keep_position: true });
  }, [send]);

  // The player contract for the mini player: one object for the whole visit, reading the newest
  // session each time it is asked.
  const volumeTimer = useRef(0);
  const lastAudible = useRef(50);
  useEffect(() => () => window.clearTimeout(volumeTimer.current), []);
  const player = useMemo<PlayerLike>(() => {
    const settle = (percent: number) => {
      window.clearTimeout(volumeTimer.current);
      volumeTimer.current = window.setTimeout(() => void setVolume(percent), VOLUME_SETTLE_MS);
    };
    return {
      state: IDLE_NOW,
      onChange: () => undefined,
      playFrom: (position, offset = 0) => seekTo(position, offset * 1000),
      togglePause: toggle,
      next,
      previous,
      skip: next,
      seek: async (seconds) => {
        const at = latest.current.session;
        if (at) await seekTo(at.song_index, seconds * 1000);
      },
      // the speaker is another device: nothing here to stop
      stop: () => undefined,
      toggleMute: () => {
        const level = levelOf(latest.current.session);
        if (level > 0) { lastAudible.current = level; void setVolume(0); } else void setVolume(lastAudible.current);
      },
      setVolume: (volume) => { if (Number.isFinite(volume)) settle(volume * 100); },
      getSpectrum: () => null,
    };
  }, [next, previous, seekTo, setVolume, toggle]);

  if (!view || !session) return null;
  // every line about the speaker reads the same session the controls show
  const shown: SessionView = session === seen ? view : { ...view, session };
  const current = entryAt(session, book, session.song_index) ?? { index: session.song_index, songId: -1, title: `Song ${session.song_index + 1} of ${session.programme.length}`, artist: '', durationMs: null, known: false };
  const level = Math.max(0, Math.min(100, levelOf(session)));
  const now: NowState = {
    // a stopped session has no mini player; Listen says it is stopped
    phase: session.state === 'stopped' ? 'idle' : playing ? 'playing' : 'paused',
    position: session.song_index,
    songTime: positionMs() / 1000,
    duration: (current.durationMs ?? 0) / 1000,
    inSeam: false,
    seamAt: null,
    notice: view.speaker === 'offline' ? whereWords(view) : '',
    nextReady: false,
    lastSeamKey: null,
    volume: level / 100,
    muted: level === 0,
  };
  player.state = now;
  player.canSetVolume = true;
  const on = `on ${view.speaker_name ?? 'another device'}`;
  const song: MixItem = {
    position: session.song_index,
    song_id: current.songId,
    title: current.title,
    // the mini player's second line: who it is by, and where it is playing
    artist: current.artist ? `${current.artist} · ${on}` : on,
    duration: (current.durationMs ?? 0) / 1000,
    bpm: null,
    key: null,
    locked: false,
    seam: null,
  };
  return { view: shown, session, book, current, playing, positionMs, toggle, next, previous, seekTo, skipTo, setVolume, stop, setUpNext, player, now, song, hasNext: hasNext(session), pending: device.pending?.command ?? null, sentSeq: () => latest.current.device.sentSeq?.() ?? 0 };
}

const IDLE_NOW: NowState = { phase: 'idle', position: 0, songTime: 0, duration: 0, inSeam: false, seamAt: null, notice: '', nextReady: false, lastSeamKey: null, volume: 1, muted: false };
