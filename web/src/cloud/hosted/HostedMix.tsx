import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudError, type Api } from '../api';
import { Icon } from '../../ui/Icon';
import { Meter } from '../../ui/Meter';
import { Action } from '../../ui/controls';
import { audioTab } from '../../devices/audioTab';
import { TimelinePlayer, type PlayerState, type TimelinePart } from './timelinePlayer';
import {
  clock, minutes, moveName, seamWords, songNames, songsMoving, songState, stillWords, timeLeft, totalsOf,
  type HostedSong, type Seam, type SongsStatus,
} from './hostedWords';
import './hostedMix.css';

// Hosted processing (flag `cloud.hosted_render`, under the `cloud.hosted_media` grant): the
// server analyses every upload, orders a mix with the local planner, renders each transition the
// local app's way and plays the result here as rendered, gaplessly (timelinePlayer.ts). Shown only
// to hosted accounts; with the flag off nothing renders and Make a Mix is the browser mixer it was.

type Planned = { asset_id: string; move: string | null };
type MixState = {
  parts: TimelinePart[]; seams: Seam[]; complete: boolean; estimate_s: number | null; worker_seen?: boolean;
  counts: { seams_ready: number; seams_failed?: number; seams: number; songs_analysed: number; songs: number; files_ready: number };
};
type Export = { state: string; job_id?: string; url?: string | null; why?: string; estimate_s?: number };

const POLL_MS = 3000;
const problem = (error: unknown, fallback: string) => (error instanceof CloudError || error instanceof Error ? error.message || fallback : fallback);

export function HostedMix({ api, workspaceId, othersPlaying = false, stopOthers, onBrowserMixer }: {
  api: Api;
  workspaceId: string;
  /** The browser mix is making sound in this tab: the hosted mix stops (one thing plays at once). */
  othersPlaying?: boolean;
  /** Stop the browser mix before the hosted one starts. */
  stopOthers?: () => void;
  /** Offered at the foot of the card: the browser mixer, for music kept on a device. */
  onBrowserMixer?: () => void;
}) {
  const [songs, setSongs] = useState<SongsStatus | null>(null);
  const [order, setOrder] = useState<Planned[] | null>(null);
  const [mix, setMix] = useState<MixState | null>(null);
  const [exported, setExported] = useState<Export | null>(null);
  const [error, setError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [playing, setPlaying] = useState<PlayerState | null>(null);
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
  const player = useRef<TimelinePlayer | null>(null);
  const progress = useRef({ done: -1, at: Date.now() });
  const [poke, setPoke] = useState(0);

  const call = useCallback(<T,>(path: string, body?: unknown) => api<T>(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, workspaceId), [api, workspaceId]);

  // analysis: ask once for anything missing, then follow it while songs wait or run
  useEffect(() => {
    let live = true;
    let timer = 0;
    const look = async (first: boolean) => {
      try {
        const found = first ? await call<SongsStatus>('/hosted/songs/prepare', {}) : await call<SongsStatus>('/hosted/songs');
        if (!live) return;
        const totals = totalsOf(found);
        if (totals.done + totals.failed !== progress.current.done) progress.current = { done: totals.done + totals.failed, at: Date.now() };
        setSongs(found);
        if (totals.running + totals.waiting > 0) timer = window.setTimeout(() => void look(false), POLL_MS);
      } catch (problemSeen) { if (live) setError(problem(problemSeen, 'SelectaDJ could not read your songs’ progress.')); }
    };
    void look(true);
    return () => { live = false; window.clearTimeout(timer); };
  }, [call, poke]);

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
        const settled = found.seams.every((seam) => ['ready', 'failed', 'refused'].includes(seam.state));
        if (!found.complete && !(settled && found.counts.files_ready === found.counts.songs)) timer = window.setTimeout(() => void look(), POLL_MS);
      } catch (problemSeen) { if (live) setError(problem(problemSeen, 'SelectaDJ could not ask for this mix.')); }
    };
    void look();
    return () => { live = false; window.clearTimeout(timer); };
  }, [order, render]);

  // one hosted mix sounds per browser (ADR-0475 F, through a Web Lock of its own): pressing Play in
  // a second tab stops the first before it starts
  const tab = useMemo(() => audioTab(workspaceId, { lock: 'selecta-hosted-audio' }), [workspaceId]);
  useEffect(() => { tab.onTaken(() => player.current?.stop()); return () => tab.close(); }, [tab]);
  useEffect(() => { if (playing && !playing.playing) tab.release(); }, [playing, tab]);

  // leaving the page (or the tab) stops the sound and closes the audio context
  useEffect(() => {
    const leave = () => player.current?.close();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, []);

  // one thing plays at once: the browser mix starting here stops this one
  useEffect(() => { if (othersPlaying) player.current?.stop(); }, [othersPlaying]);

  const plan = async () => {
    setPlanning(true); setError(''); setExported(null); setMix(null);
    player.current?.close(); player.current = null; setPlaying(null);
    try {
      const planned = await call<{ songs: Planned[] }>('/hosted/mixes/plan', { count: 12 });
      setOrder(planned.songs.length >= 2 ? planned.songs : null);
      if (planned.songs.length < 2) setError('A mix needs at least two analysed songs.');
    } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not plan a mix.')); }
    finally { setPlanning(false); }
  };

  const playFrom = (part: number, at = 0) => {
    if (!mix || !order) return;
    stopOthers?.();
    const current = player.current ?? new TimelinePlayer(mix.parts, async () => (await render(order)).parts, setPlaying);
    player.current = current;
    // the context is made inside the press (play), and the other tab is asked to stop at once: its
    // answer takes milliseconds, the first window's read longer, so the two never sound together
    void current.play(part, at);
    void tab.claim(true).then((mine) => { if (!mine) { current.stop(); setError('Another tab of this browser is playing this mix. Stop it there, or close that tab.'); } });
  };

  const toggle = () => {
    if (playing?.playing) { player.current?.stop(); return; }
    playFrom(playing?.error ? playing.part : 0, playing?.error ? playing.at : 0);
  };

  const retrySong = async (song: HostedSong) => {
    setRetrying((was) => new Set(was).add(song.asset_id));
    try {
      try {
        await call(`/hosted/songs/${encodeURIComponent(song.asset_id)}/retry`, {});
      } catch (first) {
        // a server from before Try again for one song: ask again for every failed one
        if (!(first instanceof CloudError) || (first.status !== 404 && first.status !== 405)) throw first;
        await call('/hosted/songs/prepare', { retry: true });
      }
      progress.current = { done: -1, at: Date.now() };
      setPoke((n) => n + 1);
    } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not try that song again.')); }
    finally { setRetrying((was) => { const next = new Set(was); next.delete(song.asset_id); return next; }); }
  };

  const exportMix = async () => {
    if (!order) return;
    setError('');
    try {
      let state = await call<Export>('/hosted/mixes/export', { songs: order });
      setExported(state);
      while (state.job_id && !['ready', 'failed', 'refused'].includes(state.state)) {
        await new Promise((done) => window.setTimeout(done, POLL_MS * 2));
        const id: string = state.job_id;
        state = { ...(await call<Export>(`/hosted/exports/${encodeURIComponent(id)}`)), job_id: id };
        setExported(state);
      }
    } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not export this mix.')); }
  };

  const byId = useMemo(() => new Map((songs?.songs ?? []).map((song) => [song.asset_id, song])), [songs]);
  const totals = songs ? totalsOf(songs) : null;
  const failed = (songs?.songs ?? []).filter((song) => songState(song).state === 'failed');
  const analysing = totals ? totals.running + totals.waiting : 0;
  const moving = songs ? songsMoving(songs, progress.current.at, Date.now()) : false;
  // where each song of the order starts in the timeline (a song part per song, seams between)
  const songParts = useMemo(() => (mix?.parts ?? []).map((part, index) => (part.kind === 'song' ? index : -1)).filter((index) => index >= 0), [mix]);
  const nowPart = playing?.playing && mix ? mix.parts[playing.part] : null;
  const nowSong = playing?.playing && mix ? songParts.filter((index) => index <= playing.part).length - 1 : -1;
  const nowNames = nowPart?.kind === 'song' ? songNames(byId.get(nowPart.asset_id ?? '') ?? { name: nowPart.name }) : null;
  const ready = songs ? totalsOf(songs).done : 0;

  return (
    <section className="cloud-card hosted-mix" aria-labelledby="hosted-mix-heading" data-lift="">
      <header className="hosted-mix-head">
        <p className="cloud-eyebrow">Mixed on SelectaDJ’s servers</p>
        <h2 id="hosted-mix-heading">Your mix</h2>
        <p className="hosted-mix-lede">SelectaDJ orders your uploaded songs, renders every transition in full quality and plays the mix here exactly as it was rendered.</p>
      </header>

      {error && (
        <div className="hosted-mix-problem" role="alert">
          <Icon name="warning" size="compact" />
          <p>{error}</p>
          <button type="button" className="small" onClick={() => { setError(''); setPoke((n) => n + 1); }}>Try again</button>
        </div>
      )}

      {!songs && !error && <Meter label="Reading your songs" valueText="Checking…" />}
      {songs && totals && totals.total === 0 && <p className="hosted-mix-note">Upload songs from your Library and SelectaDJ analyses each one: tempo, key, beats and sections.</p>}
      {songs && totals && analysing > 0 && (
        <Meter
          label="Analysing your songs"
          value={totals.done + totals.failed}
          max={totals.total}
          valueText={`${totals.done} of ${totals.total} songs`}
          detail={timeLeft(songs.estimate_s, moving) ?? stillWords(songs.waiting_for)}
        />
      )}
      {songs && totals && totals.total > 0 && analysing === 0 && (
        <p className="hosted-mix-note"><Icon name="check" size="compact" /> {totals.done === 1 ? '1 song analysed' : `${totals.done} songs analysed`}{totals.failed ? `; ${totals.failed} could not be` : ''}.</p>
      )}

      {failed.length > 0 && (
        <div className="hosted-mix-failed">
          <h3>{failed.length === 1 ? 'A song could not be analysed' : `${failed.length} songs could not be analysed`}</h3>
          <ul>
            {failed.map((song) => {
              const names = songNames(song);
              const state = songState(song);
              return (
                <li key={song.asset_id} className="hosted-mix-row">
                  <span className="hosted-mix-words"><b dir="auto">{names.title}</b><span dir="auto">{state.reason ?? 'It stopped part way.'}</span></span>
                  {state.canRetry && <Action className="small" run={() => retrySong(song)} busy={retrying.has(song.asset_id)} working="Asking…">Try again</Action>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="hosted-mix-actions">
        <Action className={mix ? 'quiet' : 'primary'} disabled={ready < 2} busy={planning} working="Planning…" run={plan}>
          {order ? 'Make another mix' : 'Make a mix'}
        </Action>
        {ready < 2 && songs && <span className="hosted-mix-hint">A mix needs at least two analysed songs.</span>}
      </div>

      {mix && !mix.complete && (
        <Meter
          label="Rendering transitions"
          value={mix.counts.seams_ready + (mix.counts.seams_failed ?? 0) + mix.counts.files_ready}
          max={mix.counts.seams + mix.counts.songs}
          valueText={`${mix.counts.seams_ready} of ${mix.counts.seams} transitions`}
          detail={mix.worker_seen === false || mix.estimate_s === null ? stillWords('worker') : `${minutes(mix.estimate_s)[0].toUpperCase()}${minutes(mix.estimate_s).slice(1)} left. Play opens when every part is ready.`}
        />
      )}

      {mix && (
        <div className="hosted-player" data-playing={playing?.playing ? '' : undefined}>
          <button type="button" className="primary hosted-player-play" disabled={!mix.complete} aria-label={playing?.playing ? 'Stop the mix' : 'Play the mix'} onClick={toggle}>
            <Icon name={playing?.playing ? 'stop' : 'play'} />
          </button>
          <div className="hosted-player-now" aria-live="polite">
            {playing?.playing ? (
              playing.waiting && playing.elapsed < 0.5 ? <><b>Starting the mix…</b><span>Fetching the first few seconds</span></>
                : nowPart?.kind === 'seam' ? <><b>{moveName(nowPart.move)}</b><span>Transition into the next song</span></>
                : <><b dir="auto">{nowNames?.title}</b><span dir="auto">{nowNames?.artist}{playing.waiting ? ' · catching up' : ''}</span></>
            ) : mix.complete ? (
              <><b>Ready to play</b><span>{mix.counts.songs} songs, {mix.counts.seams_ready} rendered transitions{mix.counts.seams_failed ? `, ${mix.counts.seams_failed} straight changes` : ''}</span></>
            ) : <><b>Rendering</b><span>Play opens when every part is ready</span></>}
          </div>
          <span className="hosted-player-time">{clock(playing?.elapsed ?? 0)} / {clock(playing?.total ?? mix.parts.reduce((sum, part) => sum + part.seconds, 0))}</span>
          <Meter className="hosted-player-bar" label="Mix progress" showLabel={false} value={playing?.elapsed ?? 0} max={Math.max(1, playing?.total ?? 1)} valueText={`${clock(playing?.elapsed ?? 0)} played`} kind="meter" />
        </div>
      )}
      {playing?.error && (
        <div className="hosted-mix-problem" role="alert">
          <Icon name="warning" size="compact" />
          <p>The mix stopped: {playing.error}</p>
          <button type="button" className="small" onClick={() => playFrom(playing.part, playing.at)}>Try again</button>
        </div>
      )}

      {order && (
        <ol className="hosted-mix-tracks" aria-label="Songs in this mix">
          {order.map((planned, at) => {
            const names = songNames(byId.get(planned.asset_id));
            const seam = at < order.length - 1 ? mix?.seams[at] : undefined;
            const line = seam ? seamWords(seam) : null;
            const startPart = songParts[at];
            return (
              <li key={`${planned.asset_id}-${at}`} aria-current={at === nowSong ? 'true' : undefined}>
                <button type="button" className="queue-row hosted-mix-track" data-lift="row" disabled={!mix?.complete || startPart === undefined} aria-label={`Play from ${names.title}`} onClick={() => playFrom(startPart)}>
                  <span className="queue-place" aria-hidden="true">{at === nowSong ? <Icon name="volume" size="compact" /> : at + 1}</span>
                  <span className="queue-words"><b dir="auto">{names.title}</b><span dir="auto">{names.artist}</span></span>
                  <Icon name="play" size="compact" className="queue-play" />
                </button>
                {line && <p className="hosted-mix-seam" data-tone={line.tone}>{line.words}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {mix?.complete && (
        <div className="hosted-mix-actions">
          {order && (mix.counts.seams_failed ?? 0) > 0 && (
            <Action className="quiet small" run={async () => { try { const found = await render(order, true); setMix(found); setOrder([...order]); } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not ask again.')); } }}>Try the straight changes again</Action>
          )}
          {exported?.state === 'ready' && exported.url
            ? <a className="button small" href={exported.url} download><Icon name="download" size="toolbar" /> Download the mix (lossless FLAC)</a>
            : <Action className="quiet small" run={exportMix} busy={!!exported && !['failed', 'refused'].includes(exported.state)} working="Exporting…">Export the whole mix</Action>}
          {exported && exported.state !== 'ready' && (
            <span className="hosted-mix-hint" aria-live="polite">
              {exported.state === 'failed' || exported.state === 'refused' ? `The export could not be made: ${exported.why ?? 'it stopped part way'}` : `Exporting on SelectaDJ’s servers${exported.estimate_s ? `, ${minutes(exported.estimate_s)} left` : ''}.`}
            </span>
          )}
        </div>
      )}

      {onBrowserMixer && (
        <p className="hosted-mix-foot">Music on this device that you have not uploaded? <button type="button" className="link" onClick={onBrowserMixer}>Mix it in this browser instead</button></p>
      )}
    </section>
  );
}
