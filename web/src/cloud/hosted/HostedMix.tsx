import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudError, type Api } from '../api';
import { TimelinePlayer, type PlayerState, type TimelinePart } from './timelinePlayer';
import './hostedMix.css';

// Hosted processing (flag `cloud.hosted_render`, under the `cloud.hosted_media` grant): the
// server analyses every upload, orders a mix with the local planner, renders each transition the
// local app's way and plays the result here as rendered, gaplessly. Shown only to hosted accounts;
// with the flag off nothing renders and Make a Mix is exactly the browser mixer it was.

type Analysis = { state: string; bpm?: number | null; camelot?: string | null; why?: string };
type SongsStatus = {
  songs: { asset_id: string; name: string; analysis: Analysis }[];
  counts: Record<'ready' | 'running' | 'queued' | 'failed' | 'not_started', number>;
  estimate_s: number | null; worker_seen?: boolean; seconds_each: number; total: number;
};
type Planned = { asset_id: string; move: string | null };
type Seam = { index: number; state: string; planned_move: string | null; move?: string | null; passed?: boolean | null; fell_back?: boolean | null; why?: string };
type MixState = {
  parts: TimelinePart[]; seams: Seam[]; complete: boolean; estimate_s: number | null; worker_seen?: boolean;
  counts: { seams_ready: number; seams_failed?: number; seams: number; songs_analysed: number; songs: number; files_ready: number };
};
type Export = { state: string; job_id?: string; url?: string | null; why?: string; estimate_s?: number };

const MOVE_NAMES: Record<string, string> = {
  bass_swap_blend: 'Blend', filter_sweep: 'Filter sweep', tempo_ramp: 'Tempo ramp', cut_on_one: 'Cut',
  echo_out: 'Echo out', delay_throw: 'Delay throw', reverb_wash: 'Reverb wash', vocal_ride: 'Vocal ride',
};
const POLL_MS = 3000;
/** An export is followed at most this long (or twice its estimate, if longer) before the page stops
 * asking and offers Check again, so a job stuck in the queue is not polled for ever. */
export const EXPORT_FOLLOW_MS = 15 * 60_000;
const EXPORT_DONE = ['ready', 'failed', 'refused'];

export function minutes(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const whole = Math.round(seconds / 60);
  return whole === 1 ? 'about 1 minute' : `about ${whole} minutes`;
}

/** How long is left, or, when no worker has checked in lately, that it is waiting for one:
 * queued work has no time limit, so an estimate without a worker would never come true. */
export function waitWords(estimate: number | null, running: number): string {
  if (estimate === null) return 'Waiting for a SelectaDJ worker to start: none is running right now. Nothing is lost; it starts when one does.';
  const left = minutes(estimate);
  return `${left[0].toUpperCase()}${left.slice(1)} left${running ? ` (working on ${running} now)` : ''}.`;
}

const problem = (error: unknown, fallback: string) => (error instanceof CloudError || error instanceof Error ? error.message : fallback);

export function analysisWords(status: SongsStatus): string {
  const { ready, running, queued, failed } = status.counts;
  const left = running + queued;
  if (status.total === 0) return 'Upload songs and SelectaDJ’s servers analyse each one: tempo, key, beats and sections.';
  if (left === 0) return `All ${ready} of ${status.total} songs analysed on SelectaDJ’s servers${failed ? `; ${failed} could not be` : ''}.`;
  return `Analysing on SelectaDJ’s servers: ${ready} of ${status.total} songs done, ${left} to go. ${waitWords(status.estimate_s, running)}`;
}

function seamWords(seam: Seam): string {
  const move = seam.move ?? seam.planned_move;
  const name = move ? MOVE_NAMES[move] ?? move.replace(/_/g, ' ') : 'Transition';
  switch (seam.state) {
    case 'ready': return `${name}, rendered${seam.passed === false ? ' (a near miss on its checks)' : ', passed its checks'}`;
    case 'running': return `${name}: rendering now`;
    case 'queued': return `${name}: waiting for a worker`;
    case 'waiting_for_analysis': return 'Waiting for both songs to be analysed';
    case 'refused': return `Not started: ${seam.why ?? 'the server is busy'}`;
    case 'failed': return `Could not be rendered: ${seam.why ?? 'it stopped part way'}`;
    default: return name;
  }
}

export function HostedMix({ api, workspaceId }: { api: Api; workspaceId: string }) {
  const [songs, setSongs] = useState<SongsStatus | null>(null);
  const [order, setOrder] = useState<Planned[] | null>(null);
  const [mix, setMix] = useState<MixState | null>(null);
  const [exported, setExported] = useState<Export | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<PlayerState | null>(null);
  const [overdue, setOverdue] = useState(false);
  const player = useRef<TimelinePlayer | null>(null);
  // the export follow stops when the page is left
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const call = useCallback(<T,>(path: string, body?: unknown) => api<T>(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, workspaceId), [api, workspaceId]);

  // analysis: ask once for anything missing, then follow it while it runs
  useEffect(() => {
    let live = true;
    let timer = 0;
    const look = async (first: boolean) => {
      try {
        const found = first ? await call<SongsStatus>('/hosted/songs/prepare', {}) : await call<SongsStatus>('/hosted/songs');
        if (!live) return;
        setSongs(found);
        if (found.counts.running + found.counts.queued > 0) timer = window.setTimeout(() => void look(false), POLL_MS);
      } catch (problemSeen) { if (live) setError(problem(problemSeen, 'SelectaDJ could not read your songs’ progress.')); }
    };
    void look(true);
    return () => { live = false; window.clearTimeout(timer); };
  }, [call]);

  const render = useCallback(async (songsInOrder: Planned[], retry = false) => call<MixState>('/hosted/mixes/render', { songs: songsInOrder, retry }), [call]);

  // the mix: ask for its work and follow it until every part is ready
  useEffect(() => {
    if (!order) return;
    let live = true;
    let timer = 0;
    const look = async () => {
      try {
        const found = await render(order);
        if (!live) return;
        setMix(found);
        player.current?.setParts(found.parts);
        const stuck = found.seams.every((seam) => ['ready', 'failed', 'refused'].includes(seam.state));
        if (!found.complete && !(stuck && found.counts.files_ready === found.counts.songs)) timer = window.setTimeout(() => void look(), POLL_MS);
      } catch (problemSeen) { if (live) setError(problem(problemSeen, 'SelectaDJ could not ask for this mix.')); }
    };
    void look();
    return () => { live = false; window.clearTimeout(timer); };
  }, [order, render]);

  useEffect(() => () => player.current?.close(), []);

  const plan = async () => {
    setBusy(true); setError(''); setExported(null); setMix(null);
    player.current?.close(); player.current = null; setPlaying(null);
    try {
      const planned = await call<{ songs: Planned[] }>('/hosted/mixes/plan', { count: 12 });
      setOrder(planned.songs.length >= 2 ? planned.songs : null);
      if (planned.songs.length < 2) setError('A mix needs at least two analysed songs.');
    } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not plan a mix.')); }
    finally { setBusy(false); }
  };

  const play = () => {
    if (!mix || !order) return;
    if (playing?.playing) { player.current?.stop(); return; }
    player.current = player.current ?? new TimelinePlayer(mix.parts, async () => (await render(order)).parts, setPlaying);
    void player.current.play(0);
  };

  /** Follow an export until it ends, the page is left, or the time limit passes. */
  const follow = async (first: Export) => {
    let state = first;
    const started = Date.now();
    const limit = Math.max(EXPORT_FOLLOW_MS, (state.estimate_s ?? 0) * 2000);
    setOverdue(false);
    while (mounted.current && state.job_id && !EXPORT_DONE.includes(state.state)) {
      if (Date.now() - started > limit) { setOverdue(true); return; }
      await new Promise((done) => window.setTimeout(done, POLL_MS * 2));
      if (!mounted.current) return;
      const id: string = state.job_id;
      state = { ...(await call<Export>(`/hosted/exports/${encodeURIComponent(id)}`)), job_id: id };
      setExported(state);
    }
  };

  const exportMix = async () => {
    if (!order) return;
    setError('');
    try {
      const state = await call<Export>('/hosted/mixes/export', { songs: order });
      setExported(state);
      await follow(state);
    } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not export this mix.')); }
  };

  const checkAgain = async () => {
    if (!exported) return;
    setError('');
    try { await follow(exported); } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not check this export.')); }
  };

  const names = new Map((songs?.songs ?? []).map((song) => [song.asset_id, song.name]));
  const failed = (songs?.songs ?? []).filter((song) => song.analysis.state === 'failed');
  const nowPart = playing?.playing && mix ? mix.parts[playing.part] : null;

  return (
    <section className="cloud-card hosted-mix" aria-labelledby="hosted-mix-heading">
      <p className="cloud-eyebrow">Rendered on SelectaDJ’s servers</p>
      <h2 id="hosted-mix-heading">Your hosted mix</h2>
      {error && <p className="hosted-mix-error" role="alert">{error}</p>}
      <p aria-live="polite">{songs ? analysisWords(songs) : 'Reading your songs’ progress…'}</p>
      {failed.length > 0 && (
        <details className="hosted-mix-failed">
          <summary>{failed.length === 1 ? '1 song could not be analysed' : `${failed.length} songs could not be analysed`}</summary>
          <ul>{failed.map((song) => <li key={song.asset_id}><span dir="auto">{song.name}</span>: {song.analysis.why}</li>)}</ul>
          <button type="button" onClick={() => void call<SongsStatus>('/hosted/songs/prepare', { retry: true }).then(setSongs)}>Try again</button>
        </details>
      )}
      <div className="hosted-mix-actions">
        <button type="button" className="primary" disabled={busy || (songs?.counts.ready ?? 0) < 2} onClick={() => void plan()}>{order ? 'Plan another mix' : 'Make a mix on the server'}</button>
        {mix && <button type="button" disabled={!mix.complete} onClick={play}>{playing?.playing ? 'Stop' : 'Play the rendered mix'}</button>}
        {mix && order && (mix.counts.seams_failed ?? 0) > 0 && <button type="button" onClick={() => void render(order, true).then((found) => { setMix(found); setOrder([...order]); }).catch((problemSeen) => setError(problem(problemSeen, 'SelectaDJ could not ask again.')))}>Try the failed transitions again</button>}
        {mix?.complete && <button type="button" onClick={() => void exportMix()} disabled={!!exported && exported.state !== 'ready' && exported.state !== 'failed'}>Export the whole mix</button>}
      </div>
      {mix && (
        <p aria-live="polite">
          {mix.complete
            ? `Ready: ${mix.counts.songs} songs and ${mix.counts.seams_ready} rendered transitions, played as the server rendered them.${mix.counts.seams_failed ? ` ${mix.counts.seams_failed} could not be rendered and play as a plain change from one song to the next.` : ""}`
            : `Rendering transitions: ${mix.counts.seams_ready} of ${mix.counts.seams} ready, ${mix.counts.files_ready} of ${mix.counts.songs} lossless playback files ready. ${waitWords(mix.estimate_s, 0)}`}
        </p>
      )}
      {nowPart && <p className="hosted-mix-now" aria-live="polite">{nowPart.kind === 'seam' ? `Transition: ${MOVE_NAMES[nowPart.move ?? ''] ?? 'rendered'}` : `Playing ${nowPart.name ?? 'a song'}`}{playing?.waiting ? ' (loading the next part)' : ''}</p>}
      {playing?.error && <p className="hosted-mix-error" role="alert">{playing.error}</p>}
      {exported && (
        <p aria-live="polite">
          {exported.state === 'ready' && exported.url ? <a href={exported.url} download>Download the mix (lossless FLAC)</a>
            : exported.state === 'failed' || exported.state === 'refused' ? `The export could not be made: ${exported.why ?? 'it stopped part way'}`
            : overdue ? 'The export is taking longer than expected. It carries on on the server.'
            : `Exporting on the server${exported.estimate_s ? `, ${minutes(exported.estimate_s)} left` : ''}…`}
          {overdue && !EXPORT_DONE.includes(exported.state) && <> <button type="button" onClick={() => void checkAgain()}>Check again</button></>}
        </p>
      )}
      {order && (
        <ol className="hosted-mix-order" aria-label="Songs in this mix">
          {order.map((song, at) => (
            <li key={`${song.asset_id}-${at}`}>
              <span dir="auto">{names.get(song.asset_id) ?? 'A song'}</span>
              {at < order.length - 1 && mix?.seams[at] && <small data-state={mix.seams[at].state}>{seamWords(mix.seams[at])}</small>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
