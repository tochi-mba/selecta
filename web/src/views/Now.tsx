import { useEffect, useMemo, useRef, useState } from 'react';
import { get, MixData, post, SongDetail } from '../api';
import { clock } from '../lib';
import { ViewProps } from './shared';

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

/** The whole song as one strip, with its sections named. Where the seam falls is marked. */
function Strip({ detail, time, seamAt }: { detail: SongDetail; time: number; seamAt: number | null }) {
  const percent = (seconds: number) => (100 * seconds) / detail.duration;
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
  return (
    <div className="strip" role="img" aria-label={`${clock(time)} of ${clock(detail.duration)}`}>
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
  useEffect(() => {
    if (typeof CanvasRenderingContext2D === 'undefined') return;
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return;
    let frame = 0;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const accent = getComputedStyle(node).getPropertyValue('--accent').trim() || '#e8ff3a';
    const soft = getComputedStyle(node).getPropertyValue('--ok').trim() || '#9ed46a';
    const gradient = context.createLinearGradient(0, 180, 0, 0);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(1, soft);
    const draw = () => {
      const rect = node.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (node.width !== width || node.height !== height) {
        node.width = width;
        node.height = height;
      }
      context.clearRect(0, 0, width, height);
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
    draw();
    return () => window.cancelAnimationFrame(frame);
  }, [player, active, stage]);
  return <canvas ref={canvas} className={`music-visualizer ${stage ? 'large' : ''}`} role="img" aria-label="Live music frequency visualizer" />;
}

function Lyrics({ detail, time }: { detail: SongDetail; time: number }) {
  const lines = detail.lines;
  const index = useMemo(() => {
    let found = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].start <= time + 0.1) found = i;
      else break;
    }
    return found;
  }, [lines, time]);
  if (!lines.length) return <div className="lyrics quiet" />;
  const singing = index >= 0 && time < lines[index].end + 1.5;
  const current = index >= 0 ? lines[index] : null;
  const wordIndex = current?.words?.findIndex((word) => word.start <= time && time < word.end) ?? -1;
  return (
    <div className="lyrics" aria-live="off">
      <p className="dim">{index > 0 ? lines[index - 1].text : ' '}</p>
      <p className={singing ? 'sung' : 'dim'}>
        {current ? highlightedLine(current.text, singing ? wordIndex : -1) : ' '}
      </p>
      <p className="dim">{lines[index + 1]?.text ?? ' '}</p>
    </div>
  );
}

export function Now(props: ViewProps) {
  const { mix, mixName, now, player, setView, refreshMix, setMixData, notify, stage, toggleStage } = props;
  const item = mix[now.position];
  const next = mix[now.position + 1];
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [rated, setRated] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!item) return;
    let live = true;
    setDetail(null);
    get<SongDetail>(`/songs/${item.song_id}`).then((data) => live && setDetail(data)).catch(() => {});
    return () => {
      live = false;
    };
  }, [item?.song_id]);

  useEffect(() => setRated(''), [now.lastSeamKey]);

  const rate = async (rating: string) => {
    if (!now.lastSeamKey) return;
    await post(`/seams/${now.lastSeamKey}/rate`, { rating });
    setRated(rating);
    refreshMix();
    notify(rating === 'good' ? 'Noted. More like that.' : 'Noted. Less like that.');
  };

  const swap = async (direction: number) => {
    setSwapping(true);
    setProblem('');
    try {
      const data = await post<MixData>(`/mix/${now.position + 1}/swap?direction=${direction}`);
      setMixData(data);
      notify(`Next up: ${data.mix[now.position + 1]?.title}.`, true);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setSwapping(false);
    }
  };

  const seam = next?.seam?.state;
  const idle = now.phase === 'idle';
  const resumable = idle && now.songTime > 1;
  const eyebrow =
    now.phase === 'loading'
      ? 'Loading'
      : now.inSeam
        ? `Mixing into ${next?.title ?? 'the next song'}`
        : now.phase === 'paused'
          ? `Paused · ${mixName}`
          : mixName;
  const seamWords =
    seam?.status === 'ready'
      ? `${seam.label}, ready`
      : seam?.status === 'failed'
        ? 'That move won’t work here. Selecta will pick another.'
        : seam?.status === 'none'
          ? idle
            ? 'Waiting to render'
            : 'Getting the seam ready…'
          : 'Rendering the seam…';

  return (
    <main className={`page now ${now.inSeam ? 'in-seam' : ''} ${stage ? 'stage' : ''}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display">{item?.title}</h1>
      <p className="artist">{item?.artist}</p>

      <MusicVisualizer player={player} active={now.phase === 'playing'} stage={stage} />
      {detail && detail.id === item?.song_id && (
        <TransitionCountdown
          detail={detail}
          time={now.songTime}
          seamAt={now.seamAt}
          nextTitle={next?.title}
          ready={now.nextReady}
          inSeam={now.inSeam}
          switchAt={seam?.switch_at}
        />
      )}
      {detail && detail.id === item?.song_id && !stage && <Strip detail={detail} time={now.songTime} seamAt={now.seamAt} />}
      {detail && detail.id === item?.song_id && <Lyrics detail={detail} time={now.songTime} />}
      {stage && (
        <button className="exit-stage" onClick={toggleStage}>
          Exit fullscreen
        </button>
      )}

      {!stage && (
        <>
          <div className="transport">
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
            <button onClick={() => void player.skip()} disabled={idle} title="N">
              Skip to the seam
            </button>
            <button onClick={toggleStage} title="F">
              Fullscreen lyrics
            </button>
          </div>
          {now.notice && <p className="notice" role="status">{now.notice}</p>}

          {now.lastSeamKey && !rated && (
            <div className="thumbs" role="group" aria-label="Rate that seam">
              <span>How was that seam?</span>
              <button onClick={() => void rate('good')}>Good</button>
              <button onClick={() => void rate('bad')}>Bad</button>
            </div>
          )}

          {next ? (
            <section className="next-up">
              <p className="eyebrow">Next</p>
              <button className="next-song" onClick={() => setView('Edit')}>
                <b>{next.title}</b>
                <span>{next.artist}</span>
                <small>{seamWords}</small>
              </button>
              <div className="chips steer" role="group" aria-label="Change what plays next">
                <button onClick={() => void swap(1)} disabled={swapping}>Bigger</button>
                <button onClick={() => void swap(-1)} disabled={swapping}>Calmer</button>
                <button onClick={() => void swap(0)} disabled={swapping}>Something else</button>
              </div>
              {problem && <p className="warn" role="alert">{problem}</p>}
            </section>
          ) : (
            <section className="next-up">
              <p className="eyebrow">Next</p>
              <p className="soft">This is the last song in the mix.</p>
              <button onClick={() => setView('Edit')}>Add more songs</button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
