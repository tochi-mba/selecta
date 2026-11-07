import { KeyboardEvent, MouseEvent, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, get, MixData, post, SongDetail } from '../api';
import { clock } from '../lib';
import { VolumeControl } from '../shell/Shell';
import { orderOf } from '../state/readiness';
import { Action, announce, Problem, Skeleton, Status, Tooltip } from '../ui/controls';
import { useShownTheme } from '../state/prefs';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';
import { seamFacts } from '../ui/seam';
import { RequestsContext, RequestTag } from './Requests';
import { ViewProps } from './shared';

const VIEW_KEY = 'selecta.listen';

type ListenView = { lyrics: boolean; spectrum: boolean; timing: boolean };

function savedView(): ListenView {
  try {
    return { lyrics: false, spectrum: true, timing: true, ...JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? '{}') };
  } catch {
    return { lyrics: false, spectrum: true, timing: true };
  }
}

const SECTION_WORDS: Record<string, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  break: 'Break',
  outro: 'Outro',
  instrumental: 'Band',
};
const LYRIC_WORD = /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?$/u;

function highlightedLine(text: string, activeWord: number) {
  let word = 0;
  return text.split(/([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?)/gu).map((part, index) => {
    if (!LYRIC_WORD.test(part)) return part;
    const current = word === activeWord;
    word += 1;
    return (
      <span key={index} className={current ? 'current-word' : undefined}>
        {part}
      </span>
    );
  });
}

/** Sections as a person would name them: neighbours with the same name are one section. */
function mergedSections(detail: SongDetail) {
  const merged: { label: string; start: number; end: number }[] = [];
  for (const section of detail.sections) {
    const last = merged[merged.length - 1];
    if (last && last.label === section.label) last.end = section.end;
    else merged.push({ ...section });
  }
  return merged;
}

const CANT_SEEK = 'You can’t move around during a transition, because it plays as one finished piece. You can again once the next song has taken over.';

/** The whole song as one strip, with its sections named. Where the seam falls is marked. During a
 * transition it stays the same control, and says why it won't move rather than quietly becoming
 * something else. */
function Strip({ detail, time, seamAt, onSeek, seekBlocked }: { detail: SongDetail; time: number; seamAt: number | null; onSeek: (seconds: number) => void; seekBlocked?: boolean }) {
  const noteId = useId();
  const percent = (seconds: number) =>
    100 * Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), Math.max(detail.duration, 0)) / Math.max(detail.duration, 1);
  const shape = useMemo(() => {
    const step = 100 / Math.max(detail.peaks.length, 1);
    return detail.peaks
      .map((peak, index) => {
        const height = Math.max(peak * 100, 4);
        return `M${(index * step).toFixed(2)} ${(50 - height / 2).toFixed(1)}v${height.toFixed(1)}`;
      })
      .join('');
  }, [detail.peaks]);
  const sections = useMemo(() => mergedSections(detail), [detail]);
  const barTimes = detail.bar_times ?? [];
  const clip = `played-${detail.id}`;
  const pointAt = (event: MouseEvent<HTMLDivElement>) => {
    if (seekBlocked) {
      announce(CANT_SEEK);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width) onSeek(detail.duration * Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: time - 5, ArrowDown: time - 5, ArrowRight: time + 5, ArrowUp: time + 5, Home: 0, End: detail.duration - 1, PageDown: time - 30, PageUp: time + 30 };
    if (moves[event.key] === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (seekBlocked) announce(CANT_SEEK);
    else onSeek(moves[event.key]);
  };
  return (
    <>
    <div
      className={`strip ${seekBlocked ? 'seek-blocked' : 'can-seek'}`}
      role="slider"
      tabIndex={0}
      aria-label="Where in the song"
      aria-valuemin={0}
      aria-valuemax={Math.round(detail.duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time)} of ${clock(detail.duration)}`}
      aria-disabled={seekBlocked || undefined}
      aria-describedby={seekBlocked ? noteId : undefined}
      onClick={pointAt}
      onKeyDown={keys}
    >
      <svg className="peaks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width={percent(time)} height="100" />
          </clipPath>
        </defs>
        <path d={shape} className="unplayed" vectorEffect="non-scaling-stroke" />
        <path d={shape} className="played" clipPath={`url(#${clip})`} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bar-ticks" aria-hidden="true">
        {barTimes
          .filter((_, index) => index % Math.max(1, Math.ceil(barTimes.length / 24)) === 0)
          .map((bar, index) => (
            <i key={index} style={{ left: `${percent(bar)}%` }} />
          ))}
      </div>
      <div className="sections">
        {sections.map((section, index) => {
          const width = percent(section.end - section.start);
          return (
            <span key={index} style={{ left: `${percent(section.start)}%`, width: `${width}%` }}>
              {width > 9 ? (SECTION_WORDS[section.label] ?? section.label) : ''}
            </span>
          );
        })}
      </div>
      {seamAt !== null && <b className="seam-mark" style={{ left: `${percent(seamAt)}%` }} title={`Seam at ${clock(seamAt)}`} />}
      <b className="playhead" style={{ left: `${percent(time)}%` }} />
      <span className="time">
        {clock(time)} / {clock(detail.duration)}
      </span>
    </div>
    <p className="hint seek-note" id={noteId}>{seekBlocked ? CANT_SEEK : ' '}</p>
    </>
  );
}

function upperBound(points: number[], value: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBound(points: number[], value: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function transitionCount(detail: SongDetail, time: number, seamAt: number) {
  const barTimes = detail.bar_times ?? [];
  const beatTimes = detail.beat_times ?? [];
  if (barTimes.length < 2 || beatTimes.length === 0) return null;
  const currentBar = Math.max(0, upperBound(barTimes, time) - 1);
  const currentBeat = Math.max(0, upperBound(beatTimes, time) - 1);
  const targetBeat = Math.min(lowerBound(beatTimes, seamAt), beatTimes.length - 1);
  const barAt = lowerBound(barTimes, seamAt);
  const candidate = Math.min(barAt, barTimes.length - 1);
  const previous = Math.max(candidate - 1, 0);
  const targetBar = Math.abs(barTimes[previous] - seamAt) <= Math.abs(barTimes[candidate] - seamAt)
    ? previous
    : candidate;
  const aligned = Math.abs(barTimes[targetBar] - seamAt) <= 0.12;
  const nextBarTime = barTimes[currentBar + 1] ?? detail.duration;
  const barProgress = Math.max(0, Math.min(1, (time - barTimes[currentBar]) / (nextBarTime - barTimes[currentBar])));
  const currentBarBeat = Math.max(0, upperBound(beatTimes, barTimes[currentBar] + 1e-4) - 1);
  const beatInBar = Math.min(detail.beats_per_bar ?? 4, Math.max(1, currentBeat - currentBarBeat + 1));
  return {
    aligned,
    bars: Math.max(0, targetBar - currentBar),
    beats: Math.max(0, targetBeat - currentBeat),
    barNumber: currentBar + 1,
    beatInBar,
    barProgress,
  };
}

function TransitionCountdown({
  detail,
  time,
  seamAt,
  nextTitle,
  ready,
  inSeam,
  switchAt,
}: {
  detail: SongDetail;
  time: number;
  seamAt: number | null;
  nextTitle?: string;
  ready: boolean;
  inSeam: boolean;
  switchAt?: number;
}) {
  const beatsPerBar = detail.beats_per_bar ?? 4;
  if (!nextTitle) {
    return <section className="handoff end-of-set"><span className="eyebrow">Set flow</span><b>Last track</b><span>No transition queued</span></section>;
  }
  if (!ready || seamAt === null) {
    return <section className="handoff pending"><span className="eyebrow">Next transition</span><b>Preparing the hand-off</b><span>{nextTitle}</span><i className="pending-line" /></section>;
  }
  if (!detail.bar_times?.length || !detail.beat_times?.length) {
    return <section className="handoff pending"><span className="eyebrow">Next transition</span><b>Beat grid unavailable</b><span>{nextTitle}</span></section>;
  }
  if (inSeam) {
    const progress = Math.max(0, Math.min(1, (time - seamAt) / Math.max(switchAt ?? 0, 0.01)));
    return (
      <section className="handoff active" aria-label={`Transition into ${nextTitle} is playing`}>
        <div className="handoff-title"><span className="eyebrow">Transition in progress</span><b>{nextTitle}</b></div>
        <div className="handoff-progress"><i style={{ width: `${progress * 100}%` }} /></div>
        <span className="handoff-caption">The next song is entering</span>
      </section>
    );
  }
  const countdown = transitionCount(detail, time, seamAt);
  if (!countdown) return null;
  const shownBars = Math.min(countdown.bars, 8);
  return (
    <section
      className="handoff countdown"
      role="timer"
      aria-live="off"
      aria-label={countdown.aligned
        ? `${countdown.bars} bars until the transition; beat ${countdown.beatInBar} of ${beatsPerBar}`
        : `${countdown.beats} beats until the transition`}
    >
      <div className="countdown-number">
        <strong>{countdown.aligned ? String(countdown.bars).padStart(2, '0') : String(countdown.beats).padStart(2, '0')}</strong>
        <span>{countdown.aligned ? 'bars to transition' : 'beats to transition'}</span>
      </div>
      <div className="countdown-track" aria-hidden="true">
        {countdown.aligned && Array.from({ length: shownBars }, (_, index) => (
          <span className={index === 0 ? 'current-bar' : undefined} key={index}>
            {index === 0 && <i style={{ width: `${countdown.barProgress * 100}%` }} />}
          </span>
        ))}
        <b />
      </div>
      <div className="countdown-meta">
        {countdown.aligned && <span>Bar {countdown.barNumber} · </span>}
        <span>Beat {countdown.beatInBar} / {beatsPerBar}</span>
        <div className="beat-pips" aria-hidden="true">
          {Array.from({ length: beatsPerBar }, (_, index) => <i className={index + 1 === countdown.beatInBar ? 'on' : undefined} key={index} />)}
        </div>
      </div>
      <div className="handoff-next"><span>Next</span><b>{nextTitle}</b></div>
    </section>
  );
}

function MusicVisualizer({ player, active, stage }: { player: ViewProps['player']; active: boolean; stage: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  // its colours come from the page, so a change of theme has to draw it again
  const theme = useShownTheme();
  useEffect(() => {
    if (typeof CanvasRenderingContext2D === 'undefined') return;
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return;
    let frame = 0;
    const accent = getComputedStyle(node).getPropertyValue('--accent').trim() || '#e8ff3a';
    const soft = getComputedStyle(node).getPropertyValue('--ok').trim() || '#9ed46a';
    let gradient: CanvasGradient | null = null;
    let gradientHeight = 0;
    let lastDraw = -Infinity;
    const draw = (timestamp = 0) => {
      // nothing to look at while the tab is hidden, and the music mustn't pay for it
      if (document.hidden) {
        frame = 0;
        return;
      }
      if (active && !reduceMotion && timestamp - lastDraw < 1000 / 30) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastDraw = timestamp;
      const rect = node.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (node.width !== width || node.height !== height) {
        node.width = width;
        node.height = height;
      }
      context.clearRect(0, 0, width, height);
      if (!gradient || height !== gradientHeight) {
        gradientHeight = height;
        gradient = context.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, accent);
        gradient.addColorStop(1, soft);
      }
      const spectrum = active ? player.getSpectrum() : null;
      const bars = Math.min(72, Math.max(24, Math.floor(width / (ratio * 7))));
      const gap = 2 * ratio;
      const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);
      context.fillStyle = gradient;
      for (let index = 0; index < bars; index += 1) {
        const low = Math.floor((index / bars) ** 2 * (spectrum?.length ?? 1));
        const high = Math.max(low + 1, Math.floor(((index + 1) / bars) ** 2 * (spectrum?.length ?? 1)));
        let value = 0;
        if (spectrum) {
          for (let bin = low; bin < Math.min(high, spectrum.length); bin += 1) value = Math.max(value, spectrum[bin] / 255);
        }
        const amplitude = spectrum ? Math.max(0.035, value ** 0.8) : 0.025;
        const barHeight = Math.max(2 * ratio, amplitude * height * 0.92);
        const x = index * (barWidth + gap);
        context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
      }
      if (active && !reduceMotion) frame = window.requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!document.hidden && !frame) draw();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('resize', wake);
    // An inactive or reduced-motion canvas still needs to redraw when its
    // actual size changes, without keeping a frame loop alive for no reason.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(wake);
    observer?.observe(node);
    draw();
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('resize', wake);
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [player, active, stage, reduceMotion, theme]);
  return <canvas ref={canvas} className={`music-visualizer ${stage ? 'large' : ''}`} role="img" aria-label="Live music frequency visualizer" />;
}

/** Why there's nothing to follow along with. A song's timing is never made up to fill the gap. */
function noLyricsWords(status: string | null | undefined): string {
  switch (status) {
    case 'instrumental': return 'Instrumental';
    case 'plain': return 'Lyrics for this song aren’t timed, so they can’t follow along.';
    case 'failed': return 'Looking up lyrics for this song didn’t work. Selecta will try again later.';
    case 'synced': return 'The timed lyrics for this song couldn’t be read.';
    case null:
    case undefined: return 'Lyrics haven’t been looked up yet.';
    default: return 'No lyrics found for this song.';
  }
}

function Lyrics({ detail, time, focus }: { detail: SongDetail; time: number; focus?: boolean }) {
  const lines = detail.lines;
  const starts = useMemo(() => lines.map((line) => line.start), [lines]);
  // Audio ticks many times per second; a long lyric sheet should not be
  // scanned linearly on every tick just to find the current phrase.
  const index = useMemo(() => upperBound(starts, time + 0.1) - 1, [starts, time]);
  // the space stays the same whichever it is, so the page doesn't jump about between songs
  if (!lines.length) {
    return <div className={`lyrics quiet ${focus ? 'focus' : ''}`}><p className="dim">{noLyricsWords(detail.lyric_status)}</p></div>;
  }
  const singing = index >= 0 && time < lines[index].end + 1.5;
  const current = index >= 0 ? lines[index] : null;
  const wordIndex = current?.words?.findIndex((word) => word.start <= time && time < word.end) ?? -1;
  const around = focus ? 3 : 1;
  return (
    <div className={`lyrics ${focus ? 'focus' : ''}`} aria-live="off">
      {Array.from({ length: around }, (_, gap) => around - gap).map((back) => (
        <p className="dim" key={`before-${back}`}>{lines[index - back]?.text ?? ' '}</p>
      ))}
      <p className={singing ? 'sung' : 'dim'}>
        {current ? highlightedLine(current.text, singing ? wordIndex : -1) : ' '}
      </p>
      {Array.from({ length: around }, (_, gap) => gap + 1).map((ahead) => (
        <p className="dim" key={`after-${ahead}`}>{lines[index + ahead]?.text ?? ' '}</p>
      ))}
    </div>
  );
}

/** What makes this hand-over what it is, from what was measured and what the render reported, and
 * nothing that wasn't. */
function WhyThisTransition({ from, into, names }: { from?: ViewProps['mix'][number]; into: ViewProps['mix'][number]; names: Record<string, string> }) {
  const seam = into.seam;
  if (!seam) return null;
  const state = seam.state;
  const facts = seamFacts(seam, names);
  const tempo = from?.bpm && into.bpm ? `${Math.round(from.bpm)} → ${Math.round(into.bpm)} BPM` : null;
  const keys = from?.key && into.key ? `${from.key} → ${into.key}` : null;
  return (
    <details className="why">
      <summary>Why this transition?</summary>
      <p><Status kind={facts.kind}>{facts.words}</Status></p>
      {facts.asked && state.label && facts.asked !== state.label && <p className="hint">You asked for {facts.asked}. What will play is {state.label}.</p>}
      {state.why && <p>{state.why}</p>}
      <p className="hint">{[tempo, keys].filter(Boolean).join(' · ')}</p>
      {!!state.tried?.length && (
        <>
          <p className="hint">Also tried:</p>
          <ul className="hint">{state.tried.map((attempt) => <li key={attempt.move}>{names[attempt.move] ?? attempt.move}: {attempt.why}</li>)}</ul>
        </>
      )}
      {!!state.checks?.length && (
        <>
          <p className="hint">What was measured on the finished audio. It can’t tell you how it sounds. Only you can:</p>
          <ul className="audit">
            {state.checks.map((check) => <li key={check.name}><Status kind={check.passed ? 'ready' : 'warning'}>{check.text}</Status></li>)}
          </ul>
        </>
      )}
    </details>
  );
}

/** What's coming, what was asked for, and what will really play, kept apart. Whether it exists as
 * audio yet comes from the render, not from the plan. */
function TransitionTruth({ seam, ready, names }: { seam: ViewProps['mix'][number]['seam']; ready: boolean; names: Record<string, string> }) {
  const facts = seamFacts(seam, names);
  const state = seam?.state;
  const rendered = state?.status === 'ready';
  return (
    <div className="transition-truth">
      <p><Status kind={facts.kind}>{facts.words}</Status></p>
      {rendered && facts.asked && state?.label && facts.asked !== state.label && <p className="hint">You asked for {facts.asked}. What will play is {state.label}.</p>}
      {!rendered && state?.status !== 'failed' && <p className="hint">Planned: {facts.asked ?? 'Selecta’s choice'}. It hasn’t been made yet, so what plays can still change.</p>}
      {!ready && !rendered && <p className="hint">If it isn’t ready in time, this song plays on and the next one fades in, so the music doesn’t stop.</p>}
      {state?.status === 'failed' && <p className="hint">If it can’t be made, Selecta falls back to its own pick. You can choose another in Edit.</p>}
    </div>
  );
}

export function Now(props: ViewProps) {
  const { mix, mixName, now, player, setView, refreshMix, setMixData, notify, stage, stageFallback, toggleStage, status, openRequests } = props;
  const requests = useContext(RequestsContext);
  const item = mix[now.position];
  const next = mix[now.position + 1];
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [rated, setRated] = useState('');
  const [problem, setProblem] = useState('');
  const swapInFlight = useRef(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const rateInFlight = useRef(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [changed, setChanged] = useState<{ from: string; to: string; id: number } | null>(null);
  const [view, setViewChoice] = useState<ListenView>(savedView);
  // kept here because the Stage takes the controls away, and coming back should find them as they were
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const page = useRef<HTMLElement>(null);
  // The Stage hides whatever had focus, so focus waits on the page, where Space still plays and pauses
  useEffect(() => {
    if (stage) page.current?.focus({ preventScroll: true });
  }, [stage]);
  const choose = (change: Partial<ListenView>) => {
    const chosen = { ...view, ...change };
    setViewChoice(chosen);
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify(chosen));
    } catch {
      // it just won't be remembered next time
    }
  };

  useEffect(() => {
    if (!item) return;
    let live = true;
    setDetail(null);
    setDetailFailed(false);
    get<SongDetail>(`/songs/${item.song_id}`).then((data) => live && setDetail(data)).catch(() => { if (live) setDetailFailed(true); });
    return () => {
      live = false;
    };
  }, [item?.song_id, detailAttempt]);

  useEffect(() => setRated(''), [now.lastSeamKey]);

  const rate = async (rating: string) => {
    if (!now.lastSeamKey || rateInFlight.current) return;
    rateInFlight.current = true;
    setRateBusy(true);
    try {
      await post(`/seams/${now.lastSeamKey}/rate`, { rating });
      setRated(rating);
      refreshMix();
      notify(rating === 'good' ? 'Noted. More like that.' : 'Noted. Less like that.');
    } finally {
      rateInFlight.current = false;
      setRateBusy(false);
    }
  };

  // The place it means is the one on screen when pressed, whatever has played by the time it answers,
  // and if the mix has moved on since, it stops rather than swapping a different song.
  const swap = async (direction: number) => {
    // These are three separate buttons for one planned song. A slow reply from
    // Bigger must not race a Calmer press into an unknown final mix order.
    if (swapInFlight.current) return;
    swapInFlight.current = true;
    setSwapBusy(true);
    setProblem('');
    const place = now.position + 1;
    const before = mix[place]?.title;
    try {
      const data = await post<MixData>(`/mix/${place}/swap?direction=${direction}`, undefined, { 'x-mix-order': orderOf(mix) });
      setMixData(data);
      const after = data.mix[place];
      setChanged(after && before && after.title !== before ? { from: before, to: after.title, id: after.song_id } : null);
      notify(`Next up: ${after?.title}.`, true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      setProblem((error as Error).message);
    } finally {
      swapInFlight.current = false;
      setSwapBusy(false);
    }
  };

  const seam = next?.seam?.state;
  const idle = now.phase === 'idle';
  const resumable = idle && now.songTime > 1;
  const names = status.moves ?? {};
  const eyebrow =
    now.phase === 'loading'
      ? 'Loading'
      : now.inSeam
        ? `Mixing into ${next?.title ?? 'the next song'}`
        : now.phase === 'paused'
          ? `Paused · ${mixName}`
          : mixName;
  const shown = detail && detail.id === item?.song_id ? detail : null;
  const waiting = requests?.requests?.filter((request) => request.id > 0).length ?? 0;

  const showChanged = changed && changed.id === next?.song_id ? changed : null;
  return (
    <main ref={page} tabIndex={-1} className={`page now ${now.inSeam ? 'in-seam' : ''} ${stage ? 'stage' : ''} ${view.lyrics && !stage ? 'lyric-focus' : ''}`} id="main">
      <div className="listen-layout">
        <div className="listen-main">
          <header className="listen-identity">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="display">{item?.title}</h1>
            {item && <RequestTag item={item} />}
            <p className="artist">{item?.artist}</p>
          </header>

          {!stage && (
            <>
              <div className="transport">
                <Tooltip text="Previous song (P)">
                  <button aria-label="Previous song" disabled={idle} onClick={() => void player.previous()}><Icon name="previous" /></button>
                </Tooltip>
                <button className="primary big" disabled={now.phase === 'loading'} onClick={() => void player.togglePause()}>
                  {now.phase === 'playing'
                    ? 'Pause'
                    : now.phase === 'loading'
                      ? 'Loading…'
                      : now.phase === 'paused'
                        ? 'Resume'
                        : resumable
                          ? `Resume from ${clock(now.songTime)}`
                          : 'Play'}
                </button>
                <Tooltip text="Go straight to the next song (Shift+N)">
                  <button aria-label="Next song" aria-keyshortcuts="Shift+N" disabled={idle || !next} onClick={() => void player.next()}><Icon name="next" /></button>
                </Tooltip>
              </div>
              <div className="transport-more">
                <Tooltip text="Shortcut: N">
                  <button aria-keyshortcuts="N" onClick={() => void player.skip()} disabled={idle || !next}>
                    Jump to the transition
                  </button>
                </Tooltip>
                <VolumeControl player={player} now={now} />
                <Tooltip text="Shortcut: R">
                  <button onClick={() => openRequests?.()}>
                    Request a song{waiting ? ` (${waiting} waiting)` : ''}
                  </button>
                </Tooltip>
              </div>
              {now.notice && <p className="notice" role="status">{now.notice}</p>}
              <details className="view-options" open={viewOptionsOpen} onToggle={(event) => setViewOptionsOpen(event.currentTarget.open)}>
                <summary>Display options</summary>
                <fieldset className="listen-view" aria-label="What to show"><legend className="visually-hidden">Listening display</legend>
                <button aria-pressed={view.lyrics} onClick={() => choose({ lyrics: !view.lyrics })}>Lyrics focus</button>
                <button aria-pressed={view.spectrum} onClick={() => choose({ spectrum: !view.spectrum })}>Spectrum</button>
                <button aria-pressed={view.timing} onClick={() => choose({ timing: !view.timing })}>Beat countdown</button>
                <Tooltip text="Shortcut: F">
                  <button onClick={toggleStage}>Fullscreen lyrics</button>
                </Tooltip>
                </fieldset>
              </details>
            </>
          )}

          {(stage || (view.spectrum && !view.lyrics)) && <MusicVisualizer player={player} active={now.phase === 'playing'} stage={stage} />}
          {shown && !stage && <Strip detail={shown} time={now.songTime} seamAt={now.seamAt} seekBlocked={now.inSeam} onSeek={(seconds) => void player.seek(seconds)} />}
          {detailFailed && !shown && <Problem retry={() => setDetailAttempt((attempt) => attempt + 1)}>Couldn’t load lyrics and song details. Playback controls are still available.</Problem>}
          {shown ? <Lyrics detail={shown} time={now.songTime} focus={view.lyrics && !stage} /> : item && !detailFailed && <Skeleton variant="listen" lines={2} label="Loading this song" />}
        </div>

        <aside className="listen-side" aria-label="Coming up">
          {shown && (stage || (view.timing && !view.lyrics)) && (
            <TransitionCountdown
              detail={shown}
              time={now.songTime}
              seamAt={now.seamAt}
              nextTitle={next?.title}
              ready={now.nextReady}
              inSeam={now.inSeam}
              switchAt={seam?.switch_at}
            />
          )}

          {!stage && now.lastSeamKey && !rated && (
            <div className="thumbs" role="group" aria-label="Rate that transition">
              <span>How was that transition?</span>
              <Action waiting={rateBusy} run={() => rate('good')}>Good</Action>
              <Action waiting={rateBusy} run={() => rate('bad')}>Bad</Action>
            </div>
          )}

          {!stage && (next ? (
            <section className="next-up">
              <p className="eyebrow">Next</p>
              <button className="next-song" aria-label={`Edit upcoming song ${next.title} and its transition`} onClick={() => setView('Edit')}>
                <b>{next.title}</b>
                <span>{next.artist}</span>
                <RequestTag item={next} />
                <small className="next-edit-hint">Edit upcoming song and transition</small>
              </button>
              <TransitionTruth seam={next.seam} ready={now.nextReady} names={names} />
              <div className="chips steer" role="group" aria-label="Change what plays next">
                <Action waiting={swapBusy} run={() => swap(1)} working="Finding one…">Bigger</Action>
                <Action waiting={swapBusy} run={() => swap(-1)} working="Finding one…">Calmer</Action>
                <Action waiting={swapBusy} run={() => swap(0)} working="Finding one…">Something else</Action>
              </div>
              {showChanged && <p className="notice" role="status">Changed from {showChanged.from} to {showChanged.to}. You can undo this.</p>}
              {problem && <p className="warn" role="alert">{problem} Nothing has changed, so the plan above still stands.</p>}
              <WhyThisTransition from={item} into={next} names={names} />
            </section>
          ) : (
            <section className="next-up">
              <p className="eyebrow">Next</p>
              <p className="soft">This is the last song in the mix.</p>
              <button onClick={() => setView('Edit')}>Add more songs</button>
            </section>
          ))}
        </aside>
      </div>

      {stage && (
        <div className="stage-controls">
          {stageFallback && <p className="hint stage-notice" role="status">Your browser didn’t allow fullscreen, so this fills the page instead. Press Escape to go back.</p>}
          <button onClick={() => void player.togglePause()} disabled={now.phase === 'loading'}>{now.phase === 'playing' ? 'Pause' : 'Play'}</button>
          <button className="exit-stage" onClick={toggleStage}>Exit fullscreen</button>
        </div>
      )}
    </main>
  );
}
