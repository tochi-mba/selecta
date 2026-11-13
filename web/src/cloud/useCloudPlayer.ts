import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { Api, Asset } from './api';

// Playing a run of library songs in Cloud (docs/saas/05-storage-uploads-playback.md §5.8).
//
// - Each song plays from its prepared playback file, fetched with a short-lived signed URL.
// - One song ahead is buffered: once the current song is playing, the next one's file is
//   prepared and downloaded in full, so the hand-over doesn't wait on the network. The buffered
//   copy is held in memory as a blob, which also means its signed URL can't expire under it.
// - A signed URL that has expired mid-song (the media element fails to load more) is replaced
//   once: the page asks for a fresh URL for the same song, puts the playhead back where it was
//   and keeps playing or paused as it was. The queue never changes because of a refresh. If the
//   fresh URL fails too, the page says so rather than retrying for ever.
//
// Cloud doesn't assemble mixes with transitions yet, so "the next song and its transitions"
// is, for now, the next song in the run; the transition files will join the same buffer when
// mixes exist in Cloud.

export type Track = { id: string; name: string; url: string; buffered: boolean };
type Restore = { time: number; wasPlaying: boolean };

const PROXY_POLL_MS = 1500;
const PROXY_DEADLINE_MS = 300_000;

export function useCloudPlayer({ api, workspaceId, audio, setError, fetchImpl = fetch, skipOnFailure = false }: {
  api: Api;
  workspaceId: string;
  audio: RefObject<HTMLAudioElement | null>;
  setError: (value: string) => void;
  fetchImpl?: typeof fetch;
  /** One Cloud player (`cloud.single_audio_owner`, AV-0419-05): a song that still can't load
   * after its one refresh, or a buffered copy that fails, moves on to the next song and says
   * which song was skipped. Off, the player stops there and asks for Listen again, as before. */
  skipOnFailure?: boolean;
}) {
  const [queue, setQueue] = useState<Asset[]>([]);
  const [index, setIndex] = useState(-1);
  const [track, setTrack] = useState<Track | null>(null);
  const [preparing, setPreparing] = useState('');
  const [bufferedId, setBufferedId] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshedFor = useRef<string | null>(null);
  const restore = useRef<Restore | null>(null);
  const buffered = useRef<{ id: string; url: string } | null>(null);
  const prefetching = useRef<string | null>(null);
  // Where the playing song last was, kept apart from the element: a failed reload resets its
  // currentTime to 0 before the error arrives.
  const lastTime = useRef(0);
  const lastPlaying = useRef(false);

  const dropBuffer = () => {
    if (buffered.current) URL.revokeObjectURL(buffered.current.url);
    buffered.current = null;
    prefetching.current = null;
    setBufferedId(null);
  };
  useEffect(() => () => { generation.current += 1; dropBuffer(); }, [workspaceId]);

  /** A ready signed URL for one song's playback file, preparing it first if needed. */
  const readyUrl = useCallback(async (asset: Asset, mine: number) => {
    const path = `/assets/${encodeURIComponent(asset.id)}/playback-proxy`;
    type ProxyStatus = { status: string; url?: string };
    let result = await api<ProxyStatus>(path, { method: 'POST' }, workspaceId);
    const deadline = Date.now() + PROXY_DEADLINE_MS;
    while (result.status !== 'ready') {
      if (mine !== generation.current) return null;
      if (['failed', 'cancelled', 'quarantined', 'not_requested'].includes(result.status)) throw new Error('Audio preparation could not finish. Try Listen again.');
      if (Date.now() >= deadline) throw new Error('Audio is still being prepared. Try Listen again shortly.');
      await new Promise((resolve) => window.setTimeout(resolve, PROXY_POLL_MS));
      if (mine !== generation.current) return null;
      result = await api<ProxyStatus>(path, {}, workspaceId);
    }
    if (!result.url) throw new Error('The prepared audio link is unavailable.');
    return result.url;
  }, [api, workspaceId]);

  const start = useCallback(async (list: Asset[], at: number) => {
    const asset = list[at];
    if (!asset) return;
    const mine = ++generation.current;
    restore.current = null;
    refreshedFor.current = null;
    lastTime.current = 0;
    lastPlaying.current = false;
    setQueue(list); setIndex(at); setError('');
    const ready = buffered.current?.id === asset.id ? buffered.current : null;
    if (ready) {
      buffered.current = null; prefetching.current = null; setBufferedId(null);
      setTrack({ id: asset.id, name: asset.name, url: ready.url, buffered: true });
      return;
    }
    dropBuffer();
    setTrack(null);
    setPreparing(asset.id);
    try {
      const url = await readyUrl(asset, mine);
      if (!url || mine !== generation.current) return;
      setTrack({ id: asset.id, name: asset.name, url, buffered: false });
    } catch (problem) {
      if (mine === generation.current) setError((problem as Error).message);
    } finally {
      if (mine === generation.current) setPreparing('');
    }
  }, [readyUrl, setError]);

  /** Buffer the next song in the run, once, while this one plays. */
  const prefetchNext = useCallback(async () => {
    const next = queue[index + 1];
    if (!next || buffered.current?.id === next.id || prefetching.current === next.id) return;
    const mine = generation.current;
    prefetching.current = next.id;
    try {
      let url = await readyUrl(next, mine);
      if (!url) return;
      let response = await fetchImpl(url);
      if (response.status === 403) {
        // The link expired before it was used: one fresh one, as for the playing song.
        url = await readyUrl(next, mine);
        if (!url) return;
        response = await fetchImpl(url);
      }
      if (!response.ok) throw new Error('not buffered');
      const blob = await response.blob();
      if (mine !== generation.current || prefetching.current !== next.id) return;
      buffered.current = { id: next.id, url: URL.createObjectURL(blob) };
      setBufferedId(next.id);
    } catch {
      // Buffering is a head start, not a promise: the next song still plays, from the network.
      if (prefetching.current === next.id) prefetching.current = null;
    }
  }, [queue, index, readyUrl, fetchImpl]);

  const advance = useCallback(() => {
    if (index + 1 < queue.length) {
      const was = track;
      void start(queue, index + 1).then(() => { if (was?.buffered) URL.revokeObjectURL(was.url); });
    }
  }, [index, queue, start, track]);

  /** Give up on this song and play the next, saying so; past the end, say playback stopped. */
  const skipFailed = useCallback((current: Track) => {
    if (index + 1 < queue.length) {
      void start(queue, index + 1).then(() => {
        setError(`${current.name} could not be played, so the next song is playing.`);
        if (current.buffered) URL.revokeObjectURL(current.url);
      });
    } else {
      setError(`${current.name} could not be played and it was the last song, so playback stopped.`);
    }
  }, [index, queue, setError, start]);

  /** The media element couldn't load: refresh this song's URL once, keeping place and queue. */
  const refreshUrl = useCallback(async () => {
    const current = track;
    const element = audio.current;
    if (!current) return;
    if (current.buffered) {
      if (skipOnFailure) skipFailed(current);
      return;
    }
    if (refreshedFor.current === current.id) {
      if (skipOnFailure) { skipFailed(current); return; }
      setError('This playback link could not be refreshed. Try Listen again.');
      return;
    }
    refreshedFor.current = current.id;
    const mine = generation.current;
    const now = element && Number.isFinite(element.currentTime) ? element.currentTime : 0;
    restore.current = {
      time: Math.max(now, lastTime.current),
      wasPlaying: Boolean(element && (!element.paused || lastPlaying.current)),
    };
    try {
      const result = await api<{ status: string; url?: string }>(`/assets/${encodeURIComponent(current.id)}/playback-proxy`, {}, workspaceId);
      if (result.status !== 'ready' || !result.url) throw new Error('The prepared audio is no longer available. Try Listen again.');
      if (mine !== generation.current) return;
      setTrack({ ...current, url: result.url });
    } catch (problem) {
      if (mine !== generation.current) return;
      restore.current = null;
      if (skipOnFailure) { skipFailed(current); return; }
      setError((problem as Error).message || 'This playback link could not be refreshed.');
    }
  }, [api, audio, setError, skipFailed, skipOnFailure, track, workspaceId]);

  /** The element's position and play state, as it plays. */
  const heard = useCallback(() => {
    const element = audio.current;
    // A reload empties the element (readyState 0) and pauses it; that isn't the listener pausing.
    if (!element || restore.current || element.readyState === 0) return;
    if (element.currentTime > 0) lastTime.current = element.currentTime;
    lastPlaying.current = !element.paused;
  }, [audio]);

  /** After a refreshed URL loads, put the playhead and play state back. */
  const loaded = useCallback(() => {
    const element = audio.current;
    const back = restore.current;
    if (!element || !back) return;
    restore.current = null;
    if (back.time > 0 && Number.isFinite(element.duration) && back.time < element.duration) element.currentTime = back.time;
    if (back.wasPlaying) void element.play().catch(() => {});
    else element.pause();
  }, [audio]);

  return {
    queue, index, track, preparing, bufferedId,
    upNext: queue[index + 1] ?? null,
    start, advance, refreshUrl, loaded, prefetchNext, heard,
    autoplay: restore.current?.wasPlaying ?? true,
  };
}
