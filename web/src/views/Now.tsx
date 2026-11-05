import { useEffect, useMemo, useState } from 'react';
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
  return (
    <div className="lyrics" aria-live="off">
      <p className="dim">{index > 0 ? lines[index - 1].text : ' '}</p>
      <p className={singing ? 'sung' : 'dim'}>{index >= 0 ? lines[index].text : ' '}</p>
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
