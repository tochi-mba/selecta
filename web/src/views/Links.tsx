import { useEffect, useRef, useState } from 'react';
import { DraftList, get, Link, LinkList, MixData, post, SeamState } from '../api';
import { releaseAudio, takeAudio } from '../audio/focus';
import { etaWords } from '../lib';
import { setQuery as setAddressQuery, useQueryParam } from '../router';
import { EXPLORE_TABS } from '../shell/manifest';
import { operationId } from '../state/async';
import { AudioPreview } from '../ui/AudioPreview';
import { Icon } from '../ui/Icon';
import { Action, Menu, Problem, Skeleton, Status } from '../ui/controls';
import { LinkTabs, SearchField } from '../ui/primitives';
import { seamFacts } from '../ui/seam';
import { ViewProps } from './shared';

const HARMONIC_OWNER = 'harmonic-discoveries';

type HarmonicDiscovery = {
  id: number; song_a: number; song_b: number; title_a: string; title_b: string;
  artist_a: string; artist_b: string; status: string;
  payload: { a_at: number; b_at: number; a_end?: number; b_end?: number; bars: number; transpose: number };
};

type Audition = { chords: string[]; bar_starts: number[]; seconds: number; semitones: number };

/** Songs that may share a chord pattern, one pair at a time. One press plays what Selecta detected:
 * the chords it read, each song with those chords underneath, then both at once. Answering moves on
 * to the next pair by itself, so there's nothing to line up and nothing to remember. */
export function HarmonicDiscoveries({ secondsToPrepare }: { onListen?: () => void; secondsToPrepare?: number }) {
  const [items, setItems] = useState<HarmonicDiscovery[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState<number[]>([]);
  const [audition, setAudition] = useState<Audition | null>(null);
  const [getting, setGetting] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [bar, setBar] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState<{ target: HarmonicDiscovery; verdict: string } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const keepGoing = useRef(false);
  const preparingRequest = useRef(0);
  // the same answer sent again, because a reply got lost, keeps its name, so it can't count twice
  const verdictNames = useRef(new Map<string, string>());

  useEffect(() => {
    let live = true;
    const load = () => get<HarmonicDiscovery[]>('/discoveries').then((rows) => {
      if (live) { setItems(rows); setLoaded(true); setError(''); }
    }).catch(() => { if (live) setError('Couldn’t load these. Try again in a moment.'); });
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [attempt]);

  const waiting = items
    .filter((item) => item.status === 'new')
    .sort((a, b) => Number(skipped.includes(a.id)) - Number(skipped.includes(b.id)));
  const answered = items.filter((item) => item.status !== 'new');
  const item = waiting[0];
  const following = waiting[1];

  const steps = item
    ? [
        { key: 'chords', label: 'The chords Selecta heard' },
        { key: 'a', label: `${item.title_a}, with those chords` },
        { key: 'b', label: `${item.title_b}, moved to the same key and speed` },
        { key: 'both', label: 'Both at once' },
      ]
    : [];

  const stop = () => {
    audio.current?.pause();
    setStep(null);
    setBar(-1);
    releaseAudio(HARMONIC_OWNER);
  };
  const quietHere = () => {
    keepGoing.current = false;
    audio.current?.pause();
    setStep(null);
    setBar(-1);
  };
  // leaving the page lets the sound go
  useEffect(() => () => {
    audio.current?.pause();
    releaseAudio(HARMONIC_OWNER);
  }, []);
  const playStep = (id: number, index: number) => {
    const player = audio.current;
    if (!player) return;
    takeAudio({ id: HARMONIC_OWNER, label: 'A chord audition', stop: quietHere });
    setStep(index);
    setBar(0);
    player.src = `/api/discoveries/${id}/hear/${['chords', 'a', 'b', 'both'][index]}`;
    const source = player.src;
    void player.play()?.catch(() => {
      if (player.src !== source) return;
      keepGoing.current = false;
      stop();
      setError('Couldn’t play this audition. Try the stage again.');
    });
  };
  const hear = async (target: HarmonicDiscovery, from = 0) => {
    const request = ++preparingRequest.current;
    setGetting(true);
    setError('');
    try {
      const info = await post<Audition>(`/discoveries/${target.id}/hear`);
      // A skip, verdict or newer listen may have changed the displayed pair
      // while this response was being prepared. Never play the old pair then.
      if (request !== preparingRequest.current || item?.id !== target.id) return;
      setAudition(info);
      keepGoing.current = true;
      playStep(target.id, from);
    } catch (problem) {
      if (request === preparingRequest.current) setError((problem as Error).message);
    } finally {
      if (request === preparingRequest.current) setGetting(false);
    }
  };

  // the next pair is ready the moment it's needed
  useEffect(() => {
    if (audition && following) void post(`/discoveries/${following.id}/hear`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audition, following?.id]);

  // a new pair starts by itself once someone's listening
  useEffect(() => {
    preparingRequest.current += 1;
    setGetting(false);
    setAudition(null);
    stop();
    if (keepGoing.current && item) void hear(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const review = async (target: HarmonicDiscovery, verdict: string) => {
    if (saving) return;
    const asking = `${target.id}:${verdict}`;
    const name = verdictNames.current.get(asking) ?? operationId('verdict');
    verdictNames.current.set(asking, name);
    setSaving(true);
    try {
      await post(`/discoveries/${target.id}/review`, { verdict }, { 'x-operation-id': name });
      verdictNames.current.delete(asking);
      setItems((rows) => rows.map((row) => (row.id === target.id ? { ...row, status: verdict } : row)));
      setError('');
      setUnsaved(null);
    } catch {
      setError('Couldn’t save that. Try again.');
      setUnsaved({ target, verdict });
    } finally {
      setSaving(false);
    }
  };
  const skip = (target: HarmonicDiscovery) => setSkipped((ids) => [...ids.filter((id) => id !== target.id), target.id]);

  if (!loaded && !error) return <Skeleton variant="pairs" lines={1} label="Finding harmonic discoveries" />;
  if (!loaded && error) return <Problem retry={() => setAttempt((value) => value + 1)}>{error}</Problem>;
  if (!items.length && !error) return <p className="lede">No chord matches to hear yet. They turn up as more of your library is analysed.</p>;
  const listening = step !== null;
  return (
    <section className="next-up discoveries">
      <div className="row wrap discoveries-head">
        <h2>Songs that might share chords</h2>
        {waiting.length > 0 && <span className="hint">{waiting.length} to hear</span>}
      </div>
      <p className="hint">
        Selecta plays you the chords it heard, then each song with them underneath. If they fit both, you’ve got a connection. Your answer only teaches Selecta what you hear. It never adds anything to a mix.
      </p>
      {error && <p role="alert" className="warn">{error}</p>}
      {unsaved && <button disabled={saving} onClick={() => void review(unsaved.target, unsaved.verdict)}>Try saving that again</button>}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audio}
        preload="none"
        data-testid="excerpt-player"
        onError={() => { keepGoing.current = false; stop(); setError('This audition clip is unavailable. Prepare it again to retry.'); }}
        onTimeUpdate={(event) => {
          if (!audition) return;
          const at = event.currentTarget.currentTime;
          setBar(audition.bar_starts.filter((start) => start <= at).length - 1);
        }}
        onEnded={() => {
          if (step !== null && item && step + 1 < steps.length) playStep(item.id, step + 1);
          else stop();
        }}
      />
      {item && (
        <article className="discovery">
          <h3>
            {item.title_a} <span className="soft">and</span> {item.title_b}
          </h3>
          <p className="hint">{item.artist_a} · {item.artist_b}</p>
          <button className="primary" disabled={getting} onClick={() => (listening ? (keepGoing.current = false, stop()) : void hear(item))}>
            {getting ? `Getting it ready, ${etaWords(secondsToPrepare ?? 15)}` : listening ? <><Icon name="stop" /> Stop</> : <><Icon name="play" /> Hear what Selecta heard</>}
          </button>
          <p className="discovery-now" role="status">{listening && step !== null ? `Now playing: ${steps[step].label}` : 'Nothing is playing'}</p>
          {audition && (
            <>
              <ol className="discovery-steps" aria-label="Four stages to hear">
                {steps.map((entry, index) => (
                  <li key={entry.key}>
                    <button aria-current={step === index ? 'step' : undefined} onClick={() => playStep(item.id, index)}>
                      <span className="discovery-step-number" aria-hidden="true">{index + 1}</span> {entry.label}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="chord-strip" role="img" aria-label={`The chords Selecta heard: ${audition.chords.join(', ')}`}>
                {audition.chords.map((chord, index) => (
                  <span key={index} className={index === bar ? 'now' : ''}>{chord}</span>
                ))}
              </div>
            </>
          )}
          <div className="row wrap" role="group" aria-label={`Do ${item.title_a} and ${item.title_b} sound connected?`}>
            <span>Hear a connection?</span>
            <button disabled={saving} onClick={() => void review(item, 'approved')}>Yes</button>
            <button disabled={saving} onClick={() => void review(item, 'rejected')}>No</button>
            {following && <button disabled={saving} onClick={() => skip(item)}>Skip for now</button>}
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
                <span>
                  {row.title_a} and {row.title_b}: {row.status === 'approved' ? 'connected' : 'not connected'}
                </span>
                <button disabled={saving} onClick={() => void review(row, 'new')}>Change</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function LinkCard({ link, onAdd, names, onRated, drafts }: { link: Link; onAdd: (link: Link, move: string, draft: number | null) => Promise<void>; names: Record<string, string>; onRated: () => void; drafts: { id: number; name: string }[] }) {
  const [move, setMove] = useState(link.move);
  const [cardError, setCardError] = useState('');
  const [rendering, setRendering] = useState(false);
  const renderRequest = useRef(0);
  const [override, setOverride] = useState<SeamState | null>(null);
  const [playing, setPlaying] = useState(false);
  const state = override ?? link.state;
  const busy = state.status === 'queued' || state.status === 'rendering';
  // what was asked for and what you'd really hear are kept apart, and neither says it sounds good
  const facts = seamFacts({ settings: { move }, state }, names);

  useEffect(() => {
    if (!override || !['queued', 'rendering'].includes(override.status)) return;
    const key = override.key;
    const currentRequest = renderRequest.current;
    let live = true;
    const timer = window.setInterval(() => {
      get<SeamState>(`/seams/${key}`).then((next) => {
        if (!live || currentRequest !== renderRequest.current) return;
        // A response for an older render key cannot replace the new result.
        setOverride((current) => current?.key === key ? next : current);
      }).catch(() => {});
    }, 1500);
    return () => { live = false; window.clearInterval(timer); };
  }, [override?.key, override?.status]);

  const render = async (name: string) => {
    const request = ++renderRequest.current;
    setMove(name);
    setCardError('');
    setRendering(true);
    try {
      const result = await post<SeamState>('/seams', { a: link.a, b: link.b, move: name, phrase: link.phrase });
      if (request === renderRequest.current) { setOverride(result); setPlaying(true); }
    } catch (error) { if (request === renderRequest.current) setCardError((error as Error).message); }
    finally { if (request === renderRequest.current) setRendering(false); }
  };
  const rate = async (rating: string) => {
    const request = renderRequest.current;
    const key = state.key;
    const result = await post<SeamState>(`/seams/${key}/rate`, { rating });
    // If a new style was chosen during the rating request, its render result
    // must not be displaced by the older rated audio key.
    if (request !== renderRequest.current) return;
    setOverride(result);
    onRated();
  };

  return (
    <article className={`link-card ${state.status}`}>
      <h2 className="phrase">“{link.phrase}”</h2>
      <p className="link-handoff">
        <b>{link.title_a}</b> <span>{link.artist_a}</span>
        <q>{link.line_a}</q>
      </p>
      <p className="link-handoff">
        <b>{link.title_b}</b> <span>{link.artist_b}</span>
        <q>{link.line_b}</q>
      </p>
      <div className="chips" role="group" aria-label="Which move">
        {link.moves.map((name) => (
          <button key={name} disabled={rendering} aria-pressed={move === name} onClick={() => void render(name)}>
            {names[name] ?? name}
          </button>
        ))}
      </div>
      <p className="link-status"><Status kind={facts.kind}>{facts.words}</Status></p>
      {facts.asked && state.status === 'ready' && state.label && facts.asked !== state.label && <p className="hint">You asked for {facts.asked}. What you’d hear is {state.label}.</p>}
      {cardError && <p className="warn" role="alert">{cardError}</p>}
      {state.status === 'failed' && <p className="warn">{state.error}</p>}
      {state.status === 'ready' && !state.passed && <p className="warn">This one has a rough spot. Hear it and decide.</p>}
      <div className="row wrap">
        {state.status === 'ready' ? (
          <button className="primary" onClick={() => setPlaying(!playing)}>{playing ? 'Hide' : 'Play it'}</button>
        ) : (
          <button className="primary" disabled={busy || rendering} onClick={() => void render(move)}>
            {busy ? 'Rendering…' : state.status === 'failed' ? 'Try again' : 'Render it now'}
          </button>
        )}
        {drafts.length ? (
          <Menu label="Add both to…">
            <Action role="menuitem" run={() => onAdd(link, move, null)}>Your current mix</Action>
            {drafts.map((draft) => (
              <Action role="menuitem" key={draft.id} run={() => onAdd(link, move, draft.id)}>{draft.name}</Action>
            ))}
          </Menu>
        ) : (
          <Action working="Adding…" run={() => onAdd(link, move, null)}>Add both to the mix</Action>
        )}
        {state.status === 'ready' && (
          <span className="pair" role="group" aria-label="Rate this link">
            <Action aria-pressed={state.rating === 'good'} run={() => rate('good')}>Good</Action>
            <Action aria-pressed={state.rating === 'bad'} run={() => rate('bad')}>Bad</Action>
          </span>
        )}
      </div>
      {state.status === 'ready' && playing && (
        // keyed by what was rendered, so a clip from before a change can't be taken for this one
        <AudioPreview key={state.key} autoPlay src={`/api/seams/${state.key}/preview`} startAt={Math.max((state.preview_seam ?? 0) - 8, 0)} label={`${link.title_a} into ${link.title_b}`} />
      )}
    </article>
  );
}

export function Links({ setMixData, setView, notify, status, tab = 'words' }: ViewProps & { tab?: 'words' | 'harmonic' }) {
  // it's in the address, so a search survives a reload, a shared link and coming Back
  const addressQuery = useQueryParam('q') ?? '';
  const [query, setQuery] = useState(addressQuery);
  const [data, setData] = useState<LinkList | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<{ id: number; name: string }[]>([]);
  const asked = useRef(0);

  const load = () => {
    asked.current += 1;
    const mine = asked.current;
    return get<LinkList>(`/links?q=${encodeURIComponent(query)}&limit=60`)
      .then((next) => {
        if (mine !== asked.current) return;
        setData(next);
        setFailed(false);
      })
      .catch(() => { if (mine === asked.current) setFailed(true); });
  };

  useEffect(() => {
    if (tab !== 'words') return;
    const wait = window.setTimeout(() => {
      void load();
      setAddressQuery({ q: query || null });
    }, 200);
    return () => window.clearTimeout(wait);
  }, [query, tab]);

  // Selecta prepares links in spare time, so finished ones appear as they land.
  useEffect(() => {
    if (tab !== 'words') return;
    const timer = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(timer);
  }, [query, tab]);

  useEffect(() => {
    get<DraftList>('/drafts').then((list) => setDrafts(list.drafts ?? [])).catch(() => {});
  }, []);

  // both songs and the transition between them go in together, or none of it does
  const add = async (link: Link, move: string, draft: number | null) => {
    const answer = await post<MixData>(`/mix/pair${draft === null ? '' : `?draft=${draft}`}`, { a: link.a, b: link.b, move, phrase: link.phrase });
    if (draft === null) {
      setMixData(answer);
      notify(`Added “${link.phrase}” to your mix.`, true);
      setView('Edit');
    } else {
      notify(`Added “${link.phrase}” to ${answer.name}. What’s playing hasn’t changed.`);
    }
  };

  const worked = data?.links.filter((link) => link.worked) ?? [];
  const didnt = data?.links.filter((link) => !link.worked) ?? [];
  const card = (link: Link) => (
    <LinkCard
      key={`${link.phrase}-${link.a}-${link.b}`}
      link={link}
      names={status.moves}
      drafts={drafts}
      onAdd={add}
      onRated={() => void load()}
    />
  );

  return (
    <main className="page browse" id="main">
      <LinkTabs label="Explore" items={EXPLORE_TABS} current={tab === 'harmonic' ? '/discover/harmonic' : '/discover'} />
      <h1 className="display small">{tab === 'harmonic' ? 'Harmonic matches' : 'Word connections'}</h1>
      {tab === 'harmonic' && <HarmonicDiscoveries secondsToPrepare={status.eta?.jobs.audition} />}
      {tab === 'words' && (
        <>
          <p className="lede">
            One song ends a line on these words, another opens a line with them, and the music fits too. Selecta prepares the
            best ones in the background, so they’re ready to play.
          </p>
          {data && data.preparing > 0 && (
            <p className="hint" role="status">
              {data.prepared} of the best {data.preparing} are ready. Your mix always renders first.
              {data.prepared < data.preparing && data.eta ? ` The rest take ${etaWords(data.eta)} of spare time.` : ''}
            </p>
          )}
          <SearchField label="Search shared words" value={query} onChange={setQuery} placeholder="Look for a word, like night or love" />
          {failed && data === null && <Problem retry={load}>Couldn’t search your lyrics. Nothing’s lost.</Problem>}
          {failed && data !== null && <p className="warn" role="status">Can’t check for new ones right now, so what’s shown may be out of date.</p>}
          {data === null && !failed && <Skeleton variant="pairs" lines={4} label="Searching your lyrics" />}
          {data?.links.length === 0 && (
            <p className="lede">{query ? `No links on “${query}” yet.` : 'No links yet. Analysing more songs will find more.'}</p>
          )}
          <div className="link-grid">{worked.map(card)}</div>
          {didnt.length > 0 && (
            <details className="didnt">
              <summary>{didnt.length} didn’t work so well</summary>
              <p className="hint">Still here to hear or try again. Each one says what actually happened.</p>
              <div className="link-grid">{didnt.map(card)}</div>
            </details>
          )}
        </>
      )}
    </main>
  );
}
