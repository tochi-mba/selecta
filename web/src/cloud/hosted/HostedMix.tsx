import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudError, type Api } from '../api';
import { Icon } from '../../ui/Icon';
import { Meter } from '../../ui/Meter';
import { Action } from '../../ui/controls';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { below } from '../../styles/breakpoints';
import { audioTab, type AudioTab } from '../../devices/audioTab';
import { OtherTabLine } from '../../devices/OtherTabLine';
import { TimelinePlayer, type PlayerState, type TimelinePart } from './timelinePlayer';
import {
  analysedWords, clock, downloadWords, exportWords, moveName, recordingsOf, renderDetail, seamWords, songNames, songsMoving, songState, stillWords, timeLeft, totalsOf,
  type ExportState, type HostedSong, type Seam, type SongsStatus,
} from './hostedWords';
import './hostedMix.css';

// Hosted processing (flag `cloud.hosted_render`, under the `cloud.hosted_media` grant): the
// server analyses every upload, orders a mix with the local planner, renders each transition the
// local app's way and plays the result here as rendered, gaplessly (timelinePlayer.ts). Shown only
// to hosted accounts; with the flag off nothing renders and Make a Mix is the browser mixer it was.
//
// One primary action per state: Make a mix until there is one, then Play. Everything else is a
// secondary button. Busy words are never part of a button's name while idle (ui/controls Action);
// what is happening is said once, politely, in the card's status line.

type Planned = { asset_id: string; move: string | null };
type MixState = {
  parts: TimelinePart[]; seams: Seam[]; complete: boolean; estimate_s?: number | null; worker_seen?: boolean;
  /** Why there is no estimate (a newer server): `no_worker`, `overrunning`, `busy`. */
  estimate_why?: string | null;
  counts: { seams_ready: number; seams_failed?: number; seams: number; songs_analysed: number; songs: number; files_ready: number };
};

const POLL_MS = 3000;
/** An export is followed at most this long (or twice its estimate, if longer) before the page stops
 * asking and offers Check again, so a job stuck in the queue is not polled for ever. */
export const EXPORT_FOLLOW_MS = 15 * 60_000;
const problem = (error: unknown, fallback: string) => (error instanceof CloudError || error instanceof Error ? error.message || fallback : fallback);
const finished = (state: ExportState | null) => !!state && ['ready', 'failed', 'refused'].includes(state.state);

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
  const [exported, setExported] = useState<ExportState | null>(null);
  const [error, setError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [playing, setPlaying] = useState<PlayerState | null>(null);
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
  // another tab took the sound ('away'), or that tab has let go since ('gone'): ADR-0475 F
  const [otherTab, setOtherTab] = useState<'away' | 'gone' | null>(null);
  const player = useRef<TimelinePlayer | null>(null);
  const progress = useRef({ done: -1, at: Date.now() });
  const tab = useRef<AudioTab | null>(null);
  const [poke, setPoke] = useState(0);
  const [overdue, setOverdue] = useState(false);
  // the export follow stops when the page is left
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const phone = useMediaQuery(below('tablet'));

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

  // One sound per browser (ADR-0475 F): the hosted mix and the browser mix hold the same Web Lock,
  // so pressing Play on either, in any tab, stops the other first. Made inside the effect, so a
  // development double mount never leaves a closed channel deaf to the other tabs.
  useEffect(() => {
    const mine = audioTab(workspaceId);
    tab.current = mine;
    mine.onTaken((here) => {
      const was = player.current?.state.playing;
      player.current?.stop();
      if (was && !here) setOtherTab('away');
    });
    return () => { mine.close(); if (tab.current === mine) tab.current = null; };
  }, [workspaceId]);
  useEffect(() => { if (playing && !playing.playing) tab.current?.release(); }, [playing]);
  // that tab let go (closed, or stopped): say so, and carry on here only with a press
  useEffect(() => {
    if (otherTab !== 'away') return undefined;
    const stop = new AbortController();
    void tab.current?.waitFree(stop.signal).then((free) => {
      if (!free || stop.signal.aborted) return;
      tab.current?.release();
      setOtherTab('gone');
    });
    return () => stop.abort();
  }, [otherTab]);

  // leaving the page (or the tab) stops the sound and closes the audio context
  useEffect(() => {
    const leave = () => player.current?.close();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, []);

  // one thing plays at once: the browser mix starting here stops this one
  useEffect(() => { if (othersPlaying) player.current?.stop(); }, [othersPlaying]);

  const plan = async () => {
    setPlanning(true); setError(''); setExported(null); setMix(null); setOtherTab(null);
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
    setOtherTab(null);
    const current = player.current ?? new TimelinePlayer(mix.parts, async () => (await render(order)).parts, setPlaying);
    player.current = current;
    // the context is made inside the press (play), and the other tab is asked to stop at once: its
    // answer takes milliseconds, the first window's read longer, so the two never sound together
    void current.play(part, at);
    const mine = tab.current;
    if (mine) void mine.claim(true).then((held) => { if (!held) { current.stop(); setError('Another tab of this browser is playing. Stop it there, or close that tab.'); } });
  };

  const toggle = () => {
    if (playing?.playing) { player.current?.stop(); return; }
    // Play carries on from where it stopped (a stop part way, a failure, another tab taking over)
    const from = playing && (playing.part > 0 || playing.at > 0) ? playing : null;
    playFrom(from ? from.part : 0, from ? from.at : 0);
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

  /** Follow an export until it ends, the page is left, or the time limit passes. */
  const follow = async (first: ExportState) => {
    let state = first;
    const started = Date.now();
    const limit = Math.max(EXPORT_FOLLOW_MS, (state.estimate_s ?? 0) * 2000);
    setOverdue(false);
    while (mounted.current && state.job_id && !finished(state)) {
      if (Date.now() - started > limit) { setOverdue(true); return; }
      await new Promise((done) => window.setTimeout(done, POLL_MS * 2));
      if (!mounted.current) return;
      const id: string = state.job_id;
      state = { ...(await call<ExportState>(`/hosted/exports/${encodeURIComponent(id)}`)), job_id: id };
      setExported(state);
    }
  };

  const exportMix = async () => {
    if (!order) return;
    setError('');
    try {
      // a newer server may answer `ready` at once (this exact mix was exported already) or
      // `refused` with its reason; both end the follow straight away
      const state = await call<ExportState>('/hosted/mixes/export', { songs: order });
      setExported(state);
      await follow(state);
    } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not export this mix.')); setExported(null); }
  };

  const checkAgain = async () => {
    if (!exported) return;
    setError('');
    try { await follow(exported); } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not check this export.')); }
  };

  const retrySeams = async () => {
    if (!order) return;
    try { const found = await render(order, true); setMix(found); setOrder([...order]); } catch (problemSeen) { setError(problem(problemSeen, 'SelectaDJ could not ask again.')); }
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
  const kept = recordingsOf(songs?.songs ?? []);
  // a mix plays each recording once, so two copies of one song are not two songs to mix
  const ready = totals ? Math.min(totals.done, kept.done > 0 ? kept.recordings : totals.done) : 0;
  const total = playing?.total ?? (mix ? mix.parts.reduce((sum, part) => sum + part.seconds, 0) : 0);
  const elapsed = playing?.elapsed ?? 0;
  const stoppedPartWay = !!playing && !playing.playing && !playing.error && (playing.part > 0 || playing.at > 0);
  const exporting = !!exported && !finished(exported) && !overdue;
  const exportLine = exported ? exportWords(exported) : null;
  const download = exported?.state === 'ready' && exported.url ? downloadWords(exported, phone) : null;
  // the one polite status line: what the card is doing right now, said once
  const status = planning ? 'Planning your mix…' : exporting ? 'Exporting the mix on SelectaDJ’s servers.' : exported?.state === 'ready' ? 'The mix is ready to download.' : '';

  return (
    <section className="cloud-card hosted-mix" aria-labelledby="hosted-mix-heading" data-lift="">
      <header className="hosted-mix-head">
        <p className="cloud-eyebrow">Mixed on SelectaDJ’s servers</p>
        <h2 id="hosted-mix-heading">Your mix</h2>
        <p className="hosted-mix-lede">SelectaDJ orders your uploaded songs, renders every transition in full quality and plays the mix here exactly as it was rendered.</p>
      </header>
      <p className="visually-hidden" role="status">{status}</p>

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
        <p className="hosted-mix-note"><Icon name="check" size="compact" /> {analysedWords(totals.done, kept.done === totals.done ? kept.recordings : totals.done, totals.failed)}</p>
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
                  {state.canRetry && <Action className="small" aria-label={`Try ${names.title} again`} run={() => retrySong(song)} busy={retrying.has(song.asset_id)} working="Asking…">Try again</Action>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="hosted-mix-actions">
        <Action className={mix ? undefined : 'primary'} disabled={ready < 2} busy={planning} working="Planning…" run={plan}>
          {order ? 'Make another mix' : 'Make a mix'}
        </Action>
        {ready < 2 && songs && <span className="hosted-mix-hint">A mix needs at least two different analysed songs.</span>}
      </div>

      {mix && !mix.complete && (
        <Meter
          label="Rendering transitions"
          value={mix.counts.seams_ready + (mix.counts.seams_failed ?? 0) + mix.counts.files_ready}
          max={mix.counts.seams + mix.counts.songs}
          valueText={`${mix.counts.seams_ready} of ${mix.counts.seams} transitions`}
          detail={renderDetail(mix)}
        />
      )}

      {mix && (
        <div className="hosted-player" data-playing={playing?.playing ? '' : undefined}>
          <button type="button" className="primary hosted-player-play" disabled={!mix.complete} aria-label={playing?.playing ? 'Stop the mix' : stoppedPartWay ? 'Carry on playing the mix' : 'Play the mix'} onClick={toggle}>
            <Icon name={playing?.playing ? 'stop' : 'play'} />
          </button>
          <div className="hosted-player-now" aria-live="polite">
            {playing?.playing ? (
              playing.waiting && playing.elapsed < 0.5 ? <><b>Starting the mix…</b><span>Fetching the first few seconds</span></>
                : nowPart?.kind === 'seam' ? <><b>{moveName(nowPart.move)}</b><span>Transition into the next song</span></>
                : <><b dir="auto">{nowNames?.title}</b><span dir="auto">{nowNames?.artist}{playing.waiting ? ' · catching up' : ''}</span></>
            ) : stoppedPartWay ? (
              <><b>Stopped at {clock(elapsed)}</b><span>Play carries on from there</span></>
            ) : mix.complete ? (
              <><b>Ready to play</b><span>{mix.counts.songs} songs, {mix.counts.seams_ready} rendered transitions{mix.counts.seams_failed ? `, ${mix.counts.seams_failed} straight changes` : ''}</span></>
            ) : <><b>Rendering</b><span>Play opens when every part is ready</span></>}
          </div>
          <span className="hosted-player-time" aria-hidden="true">{clock(elapsed)} / {clock(total)}</span>
          <Meter className="hosted-player-bar" label="Mix progress" showLabel={false} value={elapsed} max={Math.max(1, total)} valueText={`${clock(elapsed)} of ${clock(total)}`} kind="meter" />
        </div>
      )}
      {otherTab && <OtherTabLine gone={otherTab === 'gone'} onPlayHere={toggle} />}
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
                <button type="button" className="queue-row hosted-mix-track" data-lift="row" disabled={!mix?.complete || startPart === undefined} aria-label={`Play from ${names.title}${names.artist ? ` by ${names.artist}` : ''}`} onClick={() => playFrom(startPart)}>
                  <span className="queue-place" aria-hidden="true">{at === nowSong ? <Icon name="volume" size="toolbar" /> : at + 1}</span>
                  <span className="queue-words"><b dir="auto">{names.title}</b><span dir="auto">{names.artist}</span></span>
                  <Icon name="play" size="compact" className="queue-play" />
                </button>
                {line && <p className="hosted-mix-seam" data-tone={line.tone}>{line.words}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {mix?.complete && order && (
        <div className="hosted-mix-export">
          <div className="hosted-mix-actions">
            {(mix.counts.seams_failed ?? 0) > 0 && <Action className="small" run={retrySeams}>Try the straight changes again</Action>}
            {download && exported?.url
              // a plain link to the stored file: the browser downloads it itself, and can carry on
              // a download that stopped while the link is valid
              ? <a className="button" href={exported.url} download><Icon name="download" size="toolbar" /> {download.label}</a>
              : <Action run={exportMix} busy={exporting} working="Exporting…">{exported && finished(exported) ? 'Try the export again' : 'Export the whole mix'}</Action>}
          </div>
          {download?.note && <p className="hosted-mix-hint">{download.note}</p>}
          {exporting && exported && (
            <Meter label="Exporting the mix" value={exportLine?.fraction ?? undefined} max={1} valueText={exportLine?.value} detail={exportLine?.detail} />
          )}
          {exported && finished(exported) && exportLine?.detail && <p className="hosted-mix-hint" data-tone={exported.state === 'ready' ? undefined : 'problem'}>{exportLine.detail}</p>}
          {exported && overdue && !finished(exported) && (
            <div className="hosted-mix-actions">
              <p className="hosted-mix-hint">The export is taking longer than expected. It carries on on the server.</p>
              <Action className="small" run={checkAgain} working="Checking…">Check again</Action>
            </div>
          )}
        </div>
      )}

      {onBrowserMixer && (
        <p className="hosted-mix-foot">Music on this device that you have not uploaded? <button type="button" className="link" onClick={onBrowserMixer}>Mix it in this browser instead</button></p>
      )}
    </section>
  );
}
