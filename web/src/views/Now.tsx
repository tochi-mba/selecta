import { KeyboardEvent, PointerEvent, ReactElement, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get, MixData, post, SongDetail } from '../api';
import { flagOn, useFlags } from '../flags';
import { listed } from '../shell/manifest';
import { clock } from '../lib';
import { VolumeControl } from '../shell/Shell';
import { playLabel, SEAM_LABEL, songArtist, songTitle, transportClock } from '../audio/transportWords';
import { orderOf } from '../state/readiness';
import { Action, announce, Problem, Skeleton, Status, Tooltip } from '../ui/controls';
import { useShownTheme } from '../state/prefs';
import { useRevealed } from '../ui/Skeleton';
import { TermHint } from '../ui/Glossary';
import { Icon } from '../ui/Icon';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useReducedMotion } from '../ui/useReducedMotion';
import { seamFacts } from '../ui/seam';
import { seamFamily, SongMotif } from '../ui/MusicObjects';
import { RequestsContext, RequestTag, waitingRequestCount } from './Requests';
import { clearVisualState, createVisualState, migrateSpectrumShape, paintVisualFrame, SPECTRUM_MODES, type SpectrumShape } from './spectrumVisuals';
import { createFeatureTracker } from './visualizer/features';
import { createFrameSource, gridOf } from './visualizer/source';
import { ViewProps } from './shared';
import { FirstHandoff } from './FirstHandoff';
import { Strip, StripPlaceholder } from './NowStrip';

/** Fit the complete music title to its actual column, not the viewport.
 * Keep it in the accessibility tree and allow more lines at extreme zoom. */
function TrackTitle({ title, songId, stage }: { title: string; songId?: number; stage: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const node = heading.current;
    const container = node?.parentElement;
    if (!node || !container) return;
    const fit = () => {
      const width = node.clientWidth;
      if (!width) return;
      // MP-0275-03: a complete title wins over shrinking. The floor is a token (--title-floor, 24px),
      // so a long title wraps onto more lines at a readable size instead of being squeezed smaller.
      const minimum = Number.parseFloat(getComputedStyle(node).getPropertyValue('--title-floor')) || 24;
      const maximum = Math.max(minimum, Math.min(stage ? 40 : 52, Math.max(stage ? 24 : 28, width * (stage ? 0.055 : 0.095))));
      let low = minimum;
      let high = maximum;
      node.style.paddingBlockStart = '';
      // GP-0248-02: the large song motif sits on the first line and can be taller than it. It isn't a
      // line of text, so it must not count against the line budget and drive every title to the floor.
      const motif = node.querySelector('.song-motif')?.getBoundingClientRect().height ?? 0;
      const line = (size: number) => size * (Number.parseFloat(getComputedStyle(node).lineHeight) / size || 1.08);
      // GP-0248-03/05: on Listen the title owns a fixed slot, two lines at the largest size, so a
      // three-line title is set smaller instead of dominating, and Play/Pause and the seek bar stay in
      // the same place as songs change. Stage keeps its three-line budget. Titles too long for the
      // slot at the floor stay whole and simply take more room.
      node.style.fontSize = `${maximum}px`;
      const slot = stage ? null : line(maximum) * 2 + Math.max(0, motif - line(maximum));
      for (let index = 0; index < 9; index += 1) {
        const size = (low + high) / 2;
        node.style.fontSize = `${size}px`;
        const height = node.getBoundingClientRect().height;
        const fits = slot === null ? height - Math.max(0, motif - line(size)) <= size * 3.4 : height <= slot; // not a hair over, or Play and the seek bar slip a pixel (GP-0248-05)
        if (fits || !height) low = size;
        else high = size;
      }
      node.style.fontSize = `${low}px`;
      if (slot !== null) {
        const used = node.getBoundingClientRect().height;
        if (used && used < slot) node.style.paddingBlockStart = `${slot - used}px`;
      }
    };
    fit();
    // r8c: each fit is about twenty forced layouts, so a resize runs it once: the observer already
    // sees the container change, and the window listener is only for browsers without one
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    observer?.observe(container);
    if (!observer) window.addEventListener('resize', fit);
    let live = true;
    document.fonts?.ready.then(() => { if (live) fit(); }).catch(() => {});
    return () => { live = false; observer?.disconnect(); window.removeEventListener('resize', fit); };
  }, [title, stage]);
  return <h1 ref={heading} className="display track-title" dir="auto">
    {songId !== undefined && <SongMotif songId={songId} large />}{title}
  </h1>;
}

const VIEW_KEY = 'selecta.listen';

type ListenView = { lyrics: boolean; spectrum: boolean; timing: boolean; intensity: 'quiet' | 'standard' | 'focused'; spectrumShape: SpectrumShape };

function savedView(): ListenView {
  const defaults: ListenView = { lyrics: false, spectrum: true, timing: true, intensity: 'standard', spectrumShape: 'bars' };
  try {
    const saved = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<ListenView>;
    return { ...defaults, ...saved, intensity: ['quiet', 'standard', 'focused'].includes(saved.intensity ?? '') ? saved.intensity! : 'standard', spectrumShape: migrateSpectrumShape(saved.spectrumShape) };
  } catch {
    return defaults;
  }
}

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
  currentTitle,
  ready,
  inSeam,
  switchAt,
  phrase,
}: {
  detail: SongDetail;
  time: number;
  seamAt: number | null;
  nextTitle?: string;
  currentTitle?: string;
  ready: boolean;
  inSeam: boolean;
  switchAt?: number;
  /** The shared phrase, passed only when the rendered move really is a word hand-off on it (SF-0213-05). */
  phrase?: string;
}) {
  const beatsPerBar = detail.beats_per_bar ?? 4;
  if (!nextTitle) {
    return <section className="handoff end-of-set"><span className="eyebrow">Set flow</span><b>Last track</b><span>No transition queued</span></section>;
  }
  if (!ready || seamAt === null) {
    return <section className="handoff pending"><span className="eyebrow">Next transition</span><b>Preparing the hand-off</b><span>{nextTitle}</span><i className="pending-line" /></section>;
  }
  if (inSeam) {
    const progress = Math.max(0, Math.min(1, (time - seamAt) / Math.max(switchAt ?? 0, 0.01)));
    return (
      <section className="handoff active" aria-label={`Transition into ${nextTitle} is playing`}>
        <div className="handoff-title"><span className="eyebrow">Transition in progress</span><b>{nextTitle}</b></div>
        {currentTitle && <p className="handoff-pair" dir="auto"><span>From <b>{currentTitle}</b></span><span>Into <b>{nextTitle}</b></span></p>}
        {switchAt !== undefined && switchAt > 0 && <div className="handoff-progress"><i style={{ width: `${progress * 100}%` }} /></div>}
        {phrase && <p className="handoff-phrase" dir="auto">On the shared words “{phrase}”</p>}
        <span className="handoff-caption">The next song is entering</span>
      </section>
    );
  }
  if (!detail.bar_times?.length || !detail.beat_times?.length) {
    return <section className="handoff pending" aria-label="Time to the next transition">
      <span className="eyebrow">Next transition</span>
      <b>{clock(Math.max(0, seamAt - time))} until the hand-off</b>
      <span>{nextTitle} · Beat grid unavailable, so time is shown in minutes and seconds.</span>
    </section>;
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
        <i className="countdown-end" />
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

/** SF-0212-07: below this every level counts as silence, so a still visualizer looks again (up to
 * MAX_STILL_RETRIES times, STILL_RETRY_MS apart) for a frame with sound in it before holding one. */
const SILENT_LEVEL = 0.02;
const STILL_RETRY_MS = 250;
const MAX_STILL_RETRIES = 40;
/** Owner feedback 2026-11-12 ("I can't actually see the visualizer reacting to the music well
 * enough") raised the cap from 15 to 30 frames a second, so a kick shows within one 33 ms frame.
 * A device whose measured script cost per frame passes FRAME_BUDGET_MS drops back to 15. */
const FRAME_MS = 1000 / 30;
const SLOW_FRAME_MS = 1000 / 15;
const FRAME_BUDGET_MS = 4;
/** Styles drawn from hits alone hold a calm spectrum as their still frame under reduced motion. */
const EVENT_ONLY: SpectrumShape[] = ['sparkle', 'bursts', 'lanes', 'shock', 'grid'];

/** Exported only so its frame use can be measured (GP-0257-05). */
export function MusicVisualizer({ player, active, stage, intensity, spectrumShape, detail }: { player: ViewProps['player']; active: boolean; stage: boolean; intensity: ListenView['intensity']; spectrumShape: ListenView['spectrumShape']; detail?: SongDetail | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  // Its colours come from the page; theme and forced-colour changes repaint real analyser data.
  const theme = useShownTheme();
  const [paletteRevision, setPaletteRevision] = useState(0);
  // the song's analysed beat grid and sections, read each frame without restarting the loop
  const songGrid = useMemo(() => gridOf(detail), [detail]);
  const grid = useRef(songGrid);
  grid.current = songGrid;
  useEffect(() => {
    const contrast = window.matchMedia?.('(forced-colors: active)');
    const changed = () => setPaletteRevision((revision) => revision + 1);
    contrast?.addEventListener?.('change', changed);
    return () => contrast?.removeEventListener?.('change', changed);
  }, []);
  useEffect(() => {
    if (typeof CanvasRenderingContext2D === 'undefined') return;
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return;
    let frame = 0;
    let visible = true;
    const style = getComputedStyle(node);
    // Canvas cannot resolve CSS custom properties inside a fillStyle. Read
    // the theme's rendered tokens instead; system high-contrast foreground
    // colour is the safe fallback when a token is missing.
    const fallback = style.color;
    const forced = window.matchMedia?.('(forced-colors: active)').matches ?? false;
    const accent = forced ? fallback : style.getPropertyValue('--accent').trim() || fallback;
    const soft = forced ? 'Highlight' : style.getPropertyValue('--ok').trim() || fallback;
    const cool = forced ? 'Highlight' : style.getPropertyValue('--request').trim() || soft;
    const warm = forced ? fallback : style.getPropertyValue('--warn').trim() || accent;
    let gradient: CanvasGradient | null = null;
    let gradientHeight = 0;
    const source = createFrameSource(player);
    const tracker = createFeatureTracker();
    const state = createVisualState(spectrumShape);
    const shape: SpectrumShape = reduceMotion && EVENT_ONLY.includes(spectrumShape) ? 'bars' : spectrumShape;
    let lastDraw = -Infinity;
    let interval = FRAME_MS;
    let cost = 0;
    let costFrames = 0;
    let drewReducedFrame = false;
    delete node.dataset.frozen;
    let reducedRetries = 0;
    let retry = 0;
    const forget = () => { tracker.reset(); clearVisualState(state); };
    const draw = (timestamp = 0) => {
      // nothing to look at while the tab is hidden, and the music mustn't pay for it
      if (document.hidden || !visible) {
        forget();
        frame = 0;
        return;
      }
      // ResizeObserver and visibility wakes can arrive more than once after
      // reduced motion is enabled. Paint one real analyser frame, then keep
      // that exact bitmap until a meaningful dependency (theme, mode, size)
      // recreates this effect. Otherwise those wakes make a supposedly still
      // visualizer sample fresh analyser data and visibly animate it.
      if (reduceMotion && drewReducedFrame) {
        frame = 0;
        return;
      }
      if (active && !reduceMotion && timestamp - lastDraw < interval - 1) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastDraw = timestamp;
      const started = performance.now();
      const rect = node.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
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
      const input = active ? source.read(started, grid.current) : null;
      if (!input) {
        forget();
        // No analyzer bins means there are no measurements. Keep the surface
        // still; do not draw decorative "frequency levels" in their place.
        // Continue the visibility-limited sampling loop so a late-starting
        // audio context can begin drawing as soon as real data is available.
        if (active && !reduceMotion) frame = window.requestAnimationFrame(draw);
        else if (active && reduceMotion && reducedRetries < MAX_STILL_RETRIES) {
          reducedRetries += 1;
          retry = window.setTimeout(() => { retry = 0; wake(); }, STILL_RETRY_MS);
        }
        return;
      }
      const features = tracker.update(input);
      paintVisualFrame(context, width, height, features, shape, { accent, soft, cool, warm, gradient }, state);
      // the measured script cost of this frame; a device that can't afford 30 fps gets 15
      cost = cost * 0.9 + (performance.now() - started) * 0.1;
      costFrames += 1;
      if (costFrames % 30 === 0) {
        interval = cost > FRAME_BUDGET_MS ? SLOW_FRAME_MS : FRAME_MS;
        node.dataset.frameMs = cost.toFixed(2);
      }
      // SF-0212-07: a still visualizer keeps one frame with sound in it. Play starts on silence, so a frame
      // taken then was blank and stayed blank for the whole song (2026-11-12 reduced-motion review); until
      // real levels arrive it looks again a few times a second, then holds that frame as before.
      const heard = !features.silent && features.levels.some((level) => level > SILENT_LEVEL);
      if (reduceMotion && heard) {
        drewReducedFrame = true;
        node.dataset.frozen = 'true';
      } else if (reduceMotion && reducedRetries < MAX_STILL_RETRIES) {
        reducedRetries += 1;
        retry = window.setTimeout(() => { retry = 0; wake(); }, STILL_RETRY_MS);
      }
      if (active && !reduceMotion) frame = window.requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!document.hidden && visible && !frame) draw(performance.now());
    };
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (!visible) {
        window.cancelAnimationFrame(frame);
        forget();
        frame = 0;
      } else wake();
    });
    intersection?.observe(node);
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
      intersection?.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      forget();
    };
  }, [player, active, stage, reduceMotion, theme, paletteRevision, spectrumShape]);
  return <canvas ref={canvas} className={`music-visualizer ${stage ? 'large' : ''} ${intensity === 'focused' ? 'focused' : ''}`} role="img" aria-label={active ? `${SPECTRUM_MODES.find((mode) => mode.id === spectrumShape)?.label ?? 'Frequency'} - actual mixed-audio frequency levels` : 'Audio frequency visualizer paused'} />;
}

/** Why there's nothing to follow along with. A song's timing is never made up to fill the gap. */
function noLyricsWords(status: string | null | undefined): string {
  switch (status) {
    case 'instrumental': return 'Instrumental';
    case 'plain': return 'Lyrics for this song aren’t timed, so they can’t follow along.';
    case 'failed': return 'Looking up lyrics for this song didn’t work. SelectaDJ will try again later.';
    case 'synced': return 'The timed lyrics for this song couldn’t be read.';
    case null:
    case undefined: return 'Lyrics haven’t been looked up yet.';
    default: return 'No lyrics found for this song.';
  }
}

function Lyrics({ detail, time, focus, canBrowse = false }: { detail: SongDetail; time: number; focus?: boolean; canBrowse?: boolean }) {
  // Reading belongs to the song it was opened on, so a new song follows again. It's derived, not reset
  // in an effect: a mount effect that ran after a quick first press would undo that press.
  const [readingId, setReadingId] = useState<number | null>(null);
  const reading = readingId === detail.id;
  // and once another song is shown it is forgotten, so coming back to this one follows again
  if (readingId !== null && !reading) setReadingId(null);
  // On a phone the first screen is the song and its words, and anything to press starts below it, so
  // nothing sits half hidden behind the player at whatever height the phone is (listening.css). The
  // button comes after the words there, in the page as well as on screen, so Tab meets it where it is.
  const phone = useMediaQuery('(max-width: 760px)');
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
  const words = flagOn('listen.word_focus');
  const timingWords = detail.lyric_status === 'plain'
    ? 'Untimed lyrics - word timing unavailable.'
    : words && lines.some((line) => !!line.words?.length)
      ? 'Word highlights follow stored lyric alignment; timing may be approximate.'
      : 'Line-timed lyrics; individual word timing unavailable.';
  const browse = canBrowse && (
    <button type="button" className="lyrics-browse" aria-pressed={reading} onClick={() => setReadingId(reading ? null : detail.id)}>
      {reading ? 'Resume lyric follow' : 'Read all lyrics'}
    </button>
  );
  return (
    <div className={`lyrics ${focus ? 'focus' : ''} ${reading ? 'reading' : ''}`} aria-live="off">
      <p className="lyric-confidence">{timingWords}</p>
      {!phone && browse}
      {reading ? (
        <div className="lyrics-scroll" tabIndex={0} role="region" aria-label="All timed lyrics, scroll manually">
          {lines.map((line, at) => (
            <p key={at} dir="auto" className={at === index && singing ? 'sung' : 'dim'}>{line.text}</p>
          ))}
        </div>
      ) : (
        <>
      {Array.from({ length: around }, (_, gap) => around - gap).map((back) => (
        <p dir="auto" className="dim" key={`before-${back}`}>{lines[index - back]?.text ?? ' '}</p>
      ))}
      <p dir="auto" className={singing ? 'sung' : 'dim'}>
        {current ? highlightedLine(current.text, singing && words ? wordIndex : -1) : ' '}
      </p>
      {Array.from({ length: around }, (_, gap) => gap + 1).map((ahead) => (
        <p dir="auto" className="dim" key={`after-${ahead}`}>{lines[index + ahead]?.text ?? ' '}</p>
      ))}
        </>
      )}
      {phone && browse}
    </div>
  );
}

/** What makes this hand-over what it is, from what was measured and what the render reported, and
 * nothing that wasn't. GP-0249-05: whether it is planned or made, and what was asked for versus what
 * will play, is said once, by TransitionTruth under Up Next; this only adds the reasons. */
function WhyThisTransition({ from, into, names }: { from?: ViewProps['mix'][number]; into: ViewProps['mix'][number]; names: Record<string, string> }) {
  const seam = into.seam;
  if (!seam) return null;
  const state = seam.state;
  const tempo = from?.bpm && into.bpm ? `${Math.round(from.bpm)} → ${Math.round(into.bpm)} BPM` : null;
  const keys = from?.key && into.key ? `${from.key} → ${into.key}` : null;
  return (
    <details className="why">
      <summary>Why this transition?</summary>
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
      <p><Status kind={facts.kind}>{facts.words}</Status><TermHint term="transition" /></p>
      {rendered && facts.asked && state?.label && facts.asked !== state.label && <p className="hint">You asked for {facts.asked}. What will play is {state.label}.</p>}
      {!rendered && state?.status !== 'failed' && <p className="hint">Planned: {facts.asked ?? 'SelectaDJ’s choice'}. It hasn’t been made yet, so what plays can still change.<TermHint term="planned" /></p>}
      {!ready && !rendered && <p className="hint">If it isn’t ready in time, this song plays on and the next one fades in, so the music doesn’t stop.</p>}
      {state?.status === 'failed' && <p className="hint">If it can’t be made, SelectaDJ falls back to its own pick. You can choose another in Edit.</p>}
    </div>
  );
}

export function Now(props: ViewProps) {
  const { mix, mixName, now, player, setView, refreshMix, setMixData, notify, stage, stageFallback, toggleStage, status, openRequests } = props;
  const requests = useContext(RequestsContext);
  const item = mix[now.position];
  const next = mix[now.position + 1];
  // UF-0374-04: after the switch point the transition into the current song is still playing
  const tail = now.inSeam && !!now.seamTail;
  const entering = tail ? item : next;
  const leaving = tail ? mix[now.position - 1] : item;
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [rated, setRated] = useState('');
  const [problem, setProblem] = useState('');
  const swapInFlight = useRef(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const rateInFlight = useRef(false);
  const latestSeamForRating = useRef(now.lastSeamKey);
  latestSeamForRating.current = now.lastSeamKey;
  const [rateBusy, setRateBusy] = useState(false);
  const [changed, setChanged] = useState<{ from: string; to: string; id: number } | null>(null);
  const [view, setViewChoice] = useState<ListenView>(savedView);
  // Kept here because Stage takes the controls away. Returning should restore the listener's
  // chosen level of detail without making expert controls compete with Play and Up Next.
  const [djControlsOpen, setDjControlsOpen] = useState(false);
  // GP-0249-06: steering lives in DJ controls, so Up Next offers a way straight to it while they're closed
  const steeringHeading = useRef<HTMLHeadingElement>(null);
  const [steerFocus, setSteerFocus] = useState(false);
  useEffect(() => {
    if (!steerFocus || !djControlsOpen) return;
    steeringHeading.current?.focus({ preventScroll: false });
    setSteerFocus(false);
  }, [steerFocus, djControlsOpen]);
  const page = useRef<HTMLElement>(null);
  const stageWasOpen = useRef(stage);
  // Stage removes the launching button while fullscreen. Put focus on a
  // stable landmark while entering, then restore the recreated launcher on
  // exit so a keyboard listener doesn't restart at the top of the page.
  useEffect(() => {
    if (stage) {
      page.current?.focus({ preventScroll: true });
    } else if (stageWasOpen.current) {
      const launcher = page.current?.querySelector<HTMLButtonElement>('[data-stage-launcher]');
      (launcher ?? page.current)?.focus({ preventScroll: true });
    }
    stageWasOpen.current = stage;
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
    const forKey = now.lastSeamKey;
    rateInFlight.current = true;
    setRateBusy(true);
    try {
      await post(`/seams/${forKey}/rate`, { rating });
      refreshMix();
      // The listener may have moved through another transition while the
      // rating was saving. Never apply this old result to the new pair.
      if (latestSeamForRating.current === forKey) {
        setRated(rating);
        notify(rating === 'good' ? 'Noted. More like that.' : 'Noted. Less like that.');
      }
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
      const swapped = !!(after && before && after.title !== before);
      setChanged(swapped ? { from: before, to: after.title, id: after.song_id } : null);
      // S4-0098-07: the server taking the request is not the same as a different song being chosen.
      notify(swapped ? `Next up: ${after?.title}.` : `Nothing else fits there, so ${before ?? 'the next song'} stays next.`, true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      setProblem((error as Error).message);
    } finally {
      swapInFlight.current = false;
      setSwapBusy(false);
    }
  };

  const seam = next?.seam?.state;
  // SF-0213-05: a shared phrase is shown only for a finished word move that didn't fall back, so a
  // planned or substituted transition never claims wordplay it doesn't have.
  const provenPhrase = next?.seam && seam?.status === 'ready' && !seam.fell_back && seamFamily(seam.style) === 'words'
    ? next.seam.settings.phrase || undefined
    : undefined;
  const idle = now.phase === 'idle';
  const resumable = idle && now.songTime > 1;
  const names = status.moves ?? {};
  const eyebrow =
    now.phase === 'loading'
      ? 'Loading'
      : now.inSeam
        ? `${SEAM_LABEL}, mixing into ${entering?.title ?? 'the next song'}`
        : now.phase === 'paused'
          ? `Paused · ${mixName}`
          : mixName;
  const shown = detail && detail.id === item?.song_id ? detail : null;
  const waiting = waitingRequestCount(requests?.requests);

  const showChanged = changed && changed.id === next?.song_id ? changed : null;
  const on = useFlags();
  const keys = on('app.shortcuts');
  const hasLyrics = on('listen.lyrics');
  const lyricFocus = view.lyrics && hasLyrics;
  const spectrum = view.spectrum && on('listen.visualizers');
  const timing = view.timing && on('listen.beat_countdown');
  const editing = on('editor');
  // the display choices there are, so the row of them closes up around any that aren't
  const toggles = [hasLyrics && 'lyrics', on('listen.visualizers') && 'spectrum', on('listen.beat_countdown') && 'timing'].filter(Boolean);
  const display = toggles.length > 0 || on('listen.visualizers') || on('listen.stage');
  const thumbs = on('ratings') && !!now.lastSeamKey && !rated;
  const steering = !!next && on('listen.steering');
  const why = !!next && on('listen.why_transition');
  const controls = on('requests') || display || thumbs || steering || why;
  const controlsHint = `${listed([
    steering && 'Shape what comes next',
    on('ratings') && 'rate transitions',
    on('requests') && 'request a song',
    display && 'change the listening display',
  ]).replace(/^./, (first) => first.toUpperCase())}.`;
  const withKey = (text: string, button: ReactElement<{ 'aria-describedby'?: string }>) => (keys ? <Tooltip text={text}>{button}</Tooltip> : button);
  return (
    <main ref={page} tabIndex={-1} className={`page now ${now.inSeam ? 'in-seam' : ''} ${stage ? 'stage' : ''} ${lyricFocus && !stage ? 'lyric-focus' : ''}`} id="main">
      <div className="listen-layout">
        <div className="listen-main">
          <header className="listen-identity">
            <p className="eyebrow">{eyebrow}</p>
            <TrackTitle title={songTitle(item)} songId={item?.song_id} stage={stage} />
            {item && <RequestTag item={item} />}
            <p className="artist" dir="auto">{songArtist(item)}</p>
          </header>

          {!stage && (
            <>
              {/* SF-0209-02: Previous, Play/Pause and Next are one named group; Play/Pause is its one primary */}
              <div className="transport" role="group" aria-label="Song controls">
                {withKey('Previous song (P)', <button aria-label="Previous song" title={keys ? undefined : 'Previous song'} disabled={idle} onClick={() => void player.previous()}><Icon name="previous" /></button>)}
                <button className="primary big" disabled={now.phase === 'loading'} onClick={() => void player.togglePause()}>
                  {resumable ? `Resume from ${transportClock(now.songTime)}` : playLabel(now.phase)}
                </button>
                {withKey('Go straight to the next song (Shift+N)', <button aria-label="Next song" title={keys ? undefined : 'Next song'} aria-keyshortcuts={keys ? 'Shift+N' : undefined} disabled={idle || !next} onClick={() => void player.next()}><Icon name="next" /></button>)}
              </div>
              <div className="transport-more">
                {withKey('Shortcut: N', (
                  <button aria-keyshortcuts={keys ? 'N' : undefined} onClick={() => void player.skip()} disabled={idle || !next}>
                    Jump to the transition
                  </button>
                ))}
                <VolumeControl player={player} now={now} />
              </div>
              {now.notice && <p className="notice" role="status">{now.notice}</p>}
              <FirstHandoff now={now} mix={mix} />
            </>
          )}

          {shown && !stage && <Strip detail={shown} time={now.songTime} seamAt={now.seamAt} seekBlocked={now.inSeam} onSeek={(seconds) => void player.seek(seconds)} />}
          {!shown && item && !detailFailed && !stage && <StripPlaceholder />}
          {(on('listen.visualizers') && view.intensity !== 'quiet' && (stage || (spectrum && !lyricFocus))) && <MusicVisualizer player={player} active={now.phase === 'playing'} stage={stage} intensity={view.intensity} spectrumShape={view.spectrumShape} detail={shown} />}
          {detailFailed && !shown && <Problem retry={() => setDetailAttempt((attempt) => attempt + 1)}>{hasLyrics ? 'Couldn’t load lyrics and song details.' : 'Couldn’t load this song’s details.'} Playback controls are still available.</Problem>}
          {hasLyrics && (shown ? <Lyrics detail={shown} time={now.songTime} focus={lyricFocus && !stage} canBrowse /> : item && !detailFailed && <Skeleton variant="listen" lines={2} label="Loading this song" retry={() => setDetailAttempt((attempt) => attempt + 1)} />)}
        </div>

        <aside className="listen-side" aria-label="Coming up">
          {shown && on('listen.beat_countdown') && (stage || (timing && !lyricFocus)) && (
            <TransitionCountdown
              detail={shown}
              time={now.songTime}
              seamAt={now.seamAt}
              nextTitle={entering?.title}
              currentTitle={leaving?.title}
              ready={now.nextReady}
              inSeam={now.inSeam}
              switchAt={tail ? undefined : seam?.switch_at}
              phrase={on('listen.handoff_phrase') && !tail ? provenPhrase : undefined}
            />
          )}

          {!stage && (next ? (
            <section className="next-up">
              <p className="eyebrow">Up Next</p>
              {editing ? (
                <button className="next-song" onClick={() => setView('Edit')}>
                  <b>{next.title}</b>
                  <span>{next.artist}</span>
                  <RequestTag item={next} />
                  <small className="next-edit-hint">Edit upcoming song and transition</small>
                </button>
              ) : (
                <div className="next-song">
                  <b>{next.title}</b>
                  <span>{next.artist}</span>
                  <RequestTag item={next} />
                </div>
              )}
              <TransitionTruth seam={next.seam} ready={now.nextReady} names={names} />
              {steering && controls && !djControlsOpen && (
                <button type="button" className="quiet next-steer-open" aria-describedby="next-steer-open-hint"
                  onClick={() => { setDjControlsOpen(true); setSteerFocus(true); }}>
                  Change the next song
                </button>
              )}
              {steering && controls && !djControlsOpen && <span id="next-steer-open-hint" className="visually-hidden">Opens DJ controls at Bigger, Calmer and Something else</span>}
            </section>
          ) : (
            <section className="next-up">
              <p className="eyebrow">Next</p>
              <p className="soft">This is the last song in the mix.</p>
              {editing && <button onClick={() => setView('Edit')}>Add more songs</button>}
            </section>
          ))}

          {!stage && controls && (
            <details className="dj-controls view-options" open={djControlsOpen} onToggle={(event) => setDjControlsOpen(event.currentTarget.open)}>
              <summary>DJ controls</summary>
              <p className="hint">{controlsHint}</p>
              {on('requests') && (
                <div className="listen-request-action">
                  {withKey('Shortcut: R', (
                    <button onClick={() => openRequests?.()}>
                      Request a song{waiting ? ` (${waiting} waiting)` : ''}
                    </button>
                  ))}
                </div>
              )}
              {display && (
              <fieldset className="listen-view" aria-label="What to show">
                <legend>Display options</legend>
                {toggles.length > 0 && (
                  <div className="listen-display-toggles" role="group" aria-label="Visible listening panels" data-count={toggles.length}>
                    {hasLyrics && <button type="button" aria-pressed={view.lyrics} onClick={() => choose({ lyrics: !view.lyrics })}>Lyrics focus</button>}
                    {on('listen.visualizers') && <button type="button" aria-pressed={view.spectrum} onClick={() => choose({ spectrum: !view.spectrum })}>Spectrum</button>}
                    {on('listen.beat_countdown') && <button type="button" aria-pressed={view.timing} onClick={() => choose({ timing: !view.timing })}>Beat countdown</button>}
                  </div>
                )}
                {lyricFocus && toggles.length > 1 && (
                  <p className="hint listen-display-note" role="status">
                    Lyrics focus temporarily hides the {listed([on('listen.visualizers') && 'spectrum', on('listen.beat_countdown') && 'countdown'])}. Your choices are remembered.
                  </p>
                )}
                {on('listen.visualizers') && (
                <>
                <div className="listen-spectrum-settings">
                  <label className="spectrum-choice">
                    <span>Audio visualizer style</span>
                    <select aria-label="Audio visualizer style" value={view.spectrumShape}
                      onChange={(event) => choose({ spectrumShape: event.target.value as SpectrumShape })}>
                      {SPECTRUM_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                    <small className="hint">{SPECTRUM_MODES.find((mode) => mode.id === view.spectrumShape)?.description}</small>
                  </label>
                  <div className="listen-intensity" role="group" aria-label="Visual intensity">
                    <span className="listen-setting-label">Visual intensity</span>
                    <div className="listen-intensity-choices">
                      {(['quiet', 'standard', 'focused'] as const).map((intensity) => (
                        <button key={intensity} type="button" aria-label={`${intensity[0].toUpperCase()}${intensity.slice(1)} visuals`}
                          aria-pressed={view.intensity === intensity} onClick={() => choose({ intensity })}>
                          {intensity === 'quiet' ? 'Quiet' : intensity === 'focused' ? 'Focused' : 'Standard'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <details className="listen-visualizer-help">
                  <summary>About the visualizer</summary>
                  <p className="hint">The visualizer follows the live mixed-audio analyser and this song’s analysed beats and sections, never a simulated beat. Each style reacts to something different: kicks, hi-hats, the bar, the stereo width or the waveform. Quiet visuals hide it without affecting playback.</p>
                </details>
                </>
                )}
                {on('listen.stage') && (
                  <div className="listen-view-footer">
                    {withKey('Shortcut: F', <button type="button" className="quiet" data-stage-launcher onClick={toggleStage}>Fullscreen lyrics</button>)}
                  </div>
                )}
              </fieldset>
              )}
              {thumbs && (
                <div className="thumbs" role="group" aria-label="Rate that transition">
                  <span>How was that transition?</span>
                  <Action waiting={rateBusy} run={() => rate('good')}>Good</Action>
                  <Action waiting={rateBusy} run={() => rate('bad')}>Bad</Action>
                </div>
              )}
              {steering && (
                <section className="listen-next-steering" aria-labelledby="listen-next-steering-title">
                  <h2 id="listen-next-steering-title" ref={steeringHeading} tabIndex={-1}>Change the next song</h2>
                  <div className="chips steer" role="group" aria-label="Change what plays next">
                    <Action waiting={swapBusy} run={() => swap(1)} working="Finding one…">Bigger</Action>
                    <Action waiting={swapBusy} run={() => swap(-1)} working="Finding one…">Calmer</Action>
                    <Action waiting={swapBusy} run={() => swap(0)} working="Finding one…">Something else</Action>
                  </div>
                  <p className="hint steer-note">Bigger and Calmer swap the next song for one with more or less measured energy<TermHint term="measured-energy" />. Something else picks a different one that fits.<TermHint term="steering" /></p>
                  {showChanged && <p className="notice" role="status">Changed from {showChanged.from} to {showChanged.to}. You can undo this.</p>}
                  {problem && <p className="warn" role="alert">{problem} Nothing has changed, so the plan above still stands.</p>}
                </section>
              )}
              {why && next && <WhyThisTransition from={item} into={next} names={names} />}
            </details>
          )}
        </aside>
      </div>

      {stage && (
        <div className="stage-controls">
          {stageFallback && <p className="hint stage-notice" role="status">Your browser didn’t allow fullscreen, so this fills the page instead. Press Escape to go back.</p>}
          <button onClick={() => void player.togglePause()} disabled={now.phase === 'loading'}>{playLabel(now.phase)}</button>
          <button className="exit-stage" onClick={toggleStage}>Exit fullscreen</button>
        </div>
      )}
    </main>
  );
}
