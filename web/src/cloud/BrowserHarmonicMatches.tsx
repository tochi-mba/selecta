import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MediaResolver } from '../media';
import { releaseAudio, takeAudio } from '../audio/focus';
import { useApi } from '../requestContext';
import { exploreTabs } from '../shell/manifest';
import { operationId } from '../state/async';
import { Icon } from '../ui/Icon';
import { Action, Problem, Skeleton } from '../ui/controls';
import { LinkTabs } from '../ui/primitives';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import type { BrowserAudition, BrowserDiscovery, ProfileProgress } from './localFirstDiscoveries';

const OWNER = 'browser-harmonic-matches';

/** Make a Mix > Harmonic matches in browser-first Cloud (cloud.browser_harmonic).
 *
 * Local mode's page plays the chords its server read bar by bar; a browser has no such search.
 * This page offers pairs whose whole-song key profiles, measured on this device, line up, and its
 * audition plays the end of one song and then the start of the other from the files here, as
 * recorded. It says exactly that. Answers stay in this browser and never add anything to a mix.
 */
export function BrowserHarmonicMatches({ resolveTrack }: { resolveTrack: MediaResolver }) {
  const { get, post } = useApi();
  const [items, setItems] = useState<BrowserDiscovery[]>([]);
  const [progress, setProgress] = useState<ProfileProgress | null>(null);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState<number[]>([]);
  const [getting, setGetting] = useState(false);
  const [step, setStep] = useState<0 | 1 | null>(null);
  const [saving, setSaving] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const audition = useRef<{ id: number; plan: BrowserAudition; urls: [string, string] } | null>(null);
  const asking = useRef(0);
  const reviewing = useRef(false);
  const here = useRef(true);
  const changes = useRef(0);

  const load = useCallback(() => {
    const seen = changes.current;
    return Promise.all([get<BrowserDiscovery[]>('/discoveries'), get<ProfileProgress>('/discoveries/progress')]).then(([rows, measured]) => {
      if (!here.current || seen !== changes.current) return;
      setItems(rows);
      setProgress(measured);
      setLoaded(true);
      setError('');
    }).catch(() => {
      if (!here.current || seen !== changes.current) return;
      // pairs already on screen stay put; a failed refresh says nothing and the next poll tries again
      setError(loadedRef.current ? '' : 'Couldn’t load these. Try again in a moment.');
    });
  }, [get]);
  useEffect(() => {
    here.current = true;
    void load();
    return () => { here.current = false; };
  }, [attempt, load]);
  // songs are measured in spare time, so new pairs turn up while the page is open
  useVisiblePoll(load, 15000);

  // the pair being looked at stays put until it is answered or skipped
  const showing = useRef<number | undefined>(undefined);
  const before = showing.current !== undefined && !skipped.includes(showing.current) ? showing.current : undefined;
  const waiting = items
    .filter((row) => row.status === 'new')
    .sort((a, b) => Number(skipped.includes(a.id)) - Number(skipped.includes(b.id)) || Number(b.id === before) - Number(a.id === before));
  const answered = items.filter((row) => row.status !== 'new');
  const item = waiting[0];
  showing.current = item?.id;
  const following = waiting[1];

  const forget = () => {
    const held = audition.current;
    audition.current = null;
    if (held) held.urls.forEach((url) => URL.revokeObjectURL(url));
  };
  const quiet = () => {
    asking.current += 1;
    audio.current?.pause();
    setStep(null);
    setGetting(false);
  };
  const stop = () => {
    quiet();
    releaseAudio(OWNER);
  };
  useEffect(() => () => {
    audio.current?.pause();
    releaseAudio(OWNER);
    forget();
  }, []);
  // a new pair starts quiet, with the last pair's audio let go
  useLayoutEffect(() => {
    stop();
    forget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const playPart = (part: 0 | 1) => {
    const player = audio.current;
    const held = audition.current;
    if (!player || !held) return;
    const stretch = part === 0 ? held.plan.a : held.plan.b;
    takeAudio({ id: OWNER, label: 'A harmonic match preview', stop: quiet });
    player.src = held.urls[part];
    // the start is set once the file's length is known, or the jump can be lost
    player.addEventListener('loadedmetadata', () => { player.currentTime = stretch.from; }, { once: true });
    setStep(part);
    const source = player.src;
    void player.play()?.catch(() => {
      if (player.src !== source) return;
      stop();
      setError('Couldn’t play this preview. Try again.');
    });
  };

  const hear = async (target: BrowserDiscovery, from: 0 | 1 = 0) => {
    const request = ++asking.current;
    setGetting(true);
    setError('');
    try {
      if (audition.current?.id !== target.id) {
        forget();
        const plan = await post<BrowserAudition>(`/discoveries/${target.id}/hear`);
        const [one, two] = await Promise.all([resolveTrack(plan.a.song), resolveTrack(plan.b.song)]);
        if (!one || !two) throw new Error('One of these songs can’t be read on this device right now. Connect your music again to hear it.');
        const [bytesA, bytesB] = await Promise.all([one.data(), two.data()]);
        if (request !== asking.current || showing.current !== target.id) return;
        audition.current = { id: target.id, plan, urls: [URL.createObjectURL(new Blob([bytesA])), URL.createObjectURL(new Blob([bytesB]))] };
      }
      if (request !== asking.current || showing.current !== target.id) return;
      playPart(from);
    } catch (problem) {
      if (request === asking.current) setError((problem as Error).message);
    } finally {
      if (request === asking.current) setGetting(false);
    }
  };

  const review = async (target: BrowserDiscovery, verdict: 'approved' | 'rejected' | 'new') => {
    if (reviewing.current) return;
    reviewing.current = true;
    setSaving(true);
    try {
      changes.current += 1;
      await post(`/discoveries/${target.id}/review`, { verdict }, { 'x-operation-id': operationId('verdict') });
      setItems((rows) => rows.map((row) => (row.id === target.id ? { ...row, status: verdict } : row)));
      setError('');
    } catch {
      setError('Couldn’t save that. Try again.');
    } finally {
      reviewing.current = false;
      setSaving(false);
    }
  };

  const measuring = progress && progress.measured + progress.unreadable < progress.songs
    ? `${progress.measured} of ${progress.songs} songs on this device measured so far. The rest are measured in spare time, and more pairs can turn up.`
    : progress ? `All ${progress.measured} songs on this device that can be measured have been.` : '';
  const intro = (
    <>
      <p className="hint">
        SelectaDJ measures each song’s key across the whole song, here on this device, and pairs songs whose key profiles line up. It doesn’t follow the chords bar by bar the way SelectaDJ on a computer does, so treat each pair as a suggestion to check by ear. Your music never leaves this device, and your answers stay in this browser and never add anything to a mix.
      </p>
      {measuring && <p className="hint" role="status">{measuring}</p>}
    </>
  );
  const steps = item ? [`The last ${Math.round(item.payload.a_end - item.payload.a_at)} seconds of ${item.title_a}`, `The first ${Math.round(item.payload.b_end - item.payload.b_at)} seconds of ${item.title_b}`] : [];

  let body;
  if (!loaded && !error) {
    body = <Skeleton variant="pairs" lines={1} label="Finding harmonic matches" retry={() => setAttempt((value) => value + 1)} />;
  } else if (!loaded && error) {
    body = <Problem retry={() => setAttempt((value) => value + 1)}>{error}</Problem>;
  } else if (!items.length && !error) {
    body = <p className="lede">No harmonic matches yet. They turn up as more of the songs on this device are measured.</p>;
  } else {
    body = (
      <>
        {error && <p role="alert" className="warn">{error}</p>}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={audio}
          preload="none"
          data-testid="excerpt-player"
          onError={() => { if (step !== null) { stop(); setError('This preview couldn’t play. Try again.'); } }}
          onTimeUpdate={(event) => {
            const held = audition.current;
            if (!held || step === null) return;
            const end = step === 0 ? held.plan.a.to : held.plan.b.to;
            if (event.currentTarget.currentTime >= end - 0.05) {
              if (step === 0) playPart(1);
              else stop();
            }
          }}
          onEnded={() => { if (step === 0) playPart(1); else stop(); }}
        />
        {item && (
          <article className="discovery" data-pair={`${item.song_a}>${item.song_b}`}>
            <p className="link-kind">Key match, a suggestion to check by ear, not a verified match</p>
            <h3>{item.title_a} <span className="soft">into</span> {item.title_b}</h3>
            <p className="hint">{item.artist_a} · {item.artist_b}</p>
            <p className="hint">
              Measured here: {item.payload.key_a} ({item.payload.camelot_a}) and {item.payload.key_b} ({item.payload.camelot_b}).
              {item.payload.transpose !== 0 && ` Their profiles line up most closely with one moved ${Math.abs(item.payload.transpose)} semitone${Math.abs(item.payload.transpose) === 1 ? '' : 's'}, but the keys already sit together, and the preview plays both as recorded.`}
            </p>
            <button className="primary" disabled={getting} onClick={() => (step !== null ? stop() : void hear(item))}>
              {getting ? 'Getting it ready…' : step !== null ? <><Icon name="stop" /> Stop</> : <><Icon name="play" /> Hear one into the other</>}
            </button>
            <p className="discovery-now" role="status">{step !== null ? `Now playing: ${steps[step]}` : 'Nothing is playing'}</p>
            <ol className="discovery-steps" aria-label="Two parts to hear">
              {steps.map((label, index) => (
                <li key={label}>
                  <button
                    aria-current={step === index ? 'step' : undefined}
                    disabled={getting}
                    onClick={() => { if (audition.current?.id === item.id) playPart(index as 0 | 1); else void hear(item, index as 0 | 1); }}
                  >
                    <span className="discovery-step-number" aria-hidden="true">{index + 1}</span> {label}
                  </button>
                </li>
              ))}
            </ol>
            <div className="row wrap" role="group" aria-label={`Do ${item.title_a} and ${item.title_b} sound connected?`}>
              <span>Hear a connection?</span>
              <Action waiting={saving} run={() => review(item, 'approved')}>Yes</Action>
              <Action waiting={saving} run={() => review(item, 'rejected')}>No</Action>
              {following && <button aria-disabled={saving || undefined} onClick={() => { if (!saving) setSkipped((ids) => [...ids.filter((id) => id !== item.id), item.id]); }}>Skip for now</button>}
            </div>
          </article>
        )}
        {!item && items.length > 0 && <p className="hint">You’ve heard them all.</p>}
        {answered.length > 0 && (
          <details className="didnt">
            <summary>{answered.length} you’ve answered</summary>
            <ul className="answered">
              {answered.map((row) => (
                <li key={row.id}>
                  <span>{row.title_a} and {row.title_b}: {row.status === 'approved' ? 'connected' : 'not connected'}</span>
                  <Action waiting={saving} run={() => review(row, 'new')}>Change</Action>
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }

  return (
    <main className="page browse" id="main">
      <LinkTabs label="Make a Mix" items={exploreTabs()} current="/discover/harmonic" />
      <h1 className="display small">Harmonic matches</h1>
      <section className="next-up discoveries">
        <div className="row wrap discoveries-head">
          <h2>Songs whose keys line up</h2>
          {loaded && waiting.length > 0 && <span className="hint">{waiting.length} to hear</span>}
        </div>
        {intro}
        {body}
      </section>
    </main>
  );
}
