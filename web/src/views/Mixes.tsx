import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { get, MixData, MixItem, post, SongRow, VibeCard } from '../api';
import { analysisWords, length, SET_LENGTHS } from '../lib';
import { PageLink } from '../shell/Shell';
import { Action, Dialog, Problem, Skeleton } from '../ui/controls';
import { Drafts } from './Drafts';
import { ViewProps } from './shared';

const GROUPS = ['The moment', 'The mood', 'The sound', 'The journey'];
const ARC_STOPS = ['Start', 'Early', 'Middle', 'Late', 'Finish'];
const DEFAULT_ARC = [62, 72, 100, 85, 68];

/** The energy each song in a mix actually has, next to what was asked for, because a library can
 * only do what the songs in it can do. */
function achievedArc(mix: MixItem[]): number[] | null {
  const known = mix.map((item) => item.energy).filter((energy): energy is number => typeof energy === 'number');
  if (known.length < 2) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  const span = high - low || 1;
  return ARC_STOPS.map((_, index) => {
    const at = Math.round((index / (ARC_STOPS.length - 1)) * (known.length - 1));
    return Math.round(((known[at] - low) / span) * 100);
  });
}

/** How the next mix gets built. It stays out of the way until someone wants it. */
function MixSetup({ status, mix, refreshStatus, notify, onClose }: Pick<ViewProps, 'status' | 'mix' | 'refreshStatus' | 'notify'> & { onClose: () => void }) {
  const [problem, setProblem] = useState('');
  const [mixLanguage, setMixLanguage] = useState(status.steering.mix_language);
  const [stemFrequency, setStemFrequency] = useState(status.steering.stems);
  const [energyArc, setEnergyArc] = useState<number[] | null>(status.steering.energy_arc);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationResults, setDestinationResults] = useState<SongRow[]>([]);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destinationFailed, setDestinationFailed] = useState(false);
  const [destinationAttempt, setDestinationAttempt] = useState(0);
  const [destination, setDestination] = useState<{ id: string; label: string } | null>(
    status.steering.target
      ? { id: status.steering.target, label: status.steering.target_label ?? `Song ${status.steering.target}` }
      : null,
  );
  // only the last thing moved gets saved, and an answer to an older save can't move it back
  const arcSaves = useRef(0);
  const savedArc = useRef(JSON.stringify(status.steering.energy_arc));
  useEffect(() => {
    if (JSON.stringify(energyArc) === savedArc.current) return;
    const timer = window.setTimeout(() => {
      arcSaves.current += 1;
      const mine = arcSaves.current;
      post('/steer', { action: 'energy_arc', value: energyArc })
        .then(() => {
          if (mine === arcSaves.current) savedArc.current = JSON.stringify(energyArc);
          refreshStatus();
        })
        .catch((error: Error) => setProblem(error.message));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [energyArc, refreshStatus]);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (query.length < 2) {
      setDestinationResults([]);
      setDestinationLoading(false);
      setDestinationFailed(false);
      return;
    }
    let live = true;
    setDestinationLoading(true);
    setDestinationFailed(false);
    setDestinationResults([]);
    const timer = window.setTimeout(() => {
      get<SongRow[]>(`/songs?q=${encodeURIComponent(query)}&state=ready&limit=20`)
        .then((rows) => {
          if (live) setDestinationResults(rows.filter((row) => !row.never && ['synced', 'instrumental'].includes(row.lyric_status ?? '')));
        })
        .catch(() => { if (live) setDestinationFailed(true); }).finally(() => { if (live) setDestinationLoading(false); });
    }, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [destinationQuery, destinationAttempt]);

  const chooseMixLanguage = async (value: string) => {
    const previous = mixLanguage;
    setMixLanguage(value);
    try {
      await post('/steer', { action: 'mix_language', value });
      refreshStatus();
    } catch (error) {
      setMixLanguage(previous);
      setProblem((error as Error).message);
    }
  };
  const chooseStemFrequency = async (value: string) => {
    const previous = stemFrequency;
    setStemFrequency(value);
    try {
      await post('/steer', { action: 'stems', value });
      refreshStatus();
    } catch (error) {
      setStemFrequency(previous);
      setProblem((error as Error).message);
    }
  };
  const chooseDestination = async (song: SongRow | null) => {
    const previous = destination;
    const next = song ? { id: String(song.id), label: `${song.title ?? 'Untitled'} — ${song.artist ?? 'Unknown artist'}` } : null;
    setDestination(next);
    try {
      await post('/steer', { action: 'take_me_to', value: next?.id ?? '' });
      setDestinationQuery('');
      setDestinationResults([]);
      refreshStatus();
      notify(next ? `Future mixes will try to land on ${next.label}.` : 'Selecta will choose the ending again.');
    } catch (error) {
      setDestination(previous);
      setProblem((error as Error).message);
    }
  };

  const arcPreview = energyArc ?? DEFAULT_ARC;
  const arcPoints = arcPreview.map((energy, index) => `${index * 25},${38 - energy * 0.34}`).join(' ');
  const achieved = achievedArc(mix);
  const achievedPoints = achieved?.map((energy, index) => `${index * 25},${38 - energy * 0.34}`).join(' ');
  const drawArcAt = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / (bounds.width || 1)) * 100;
    const y = ((event.clientY - bounds.top) / (bounds.height || 1)) * 40;
    const stop = Math.round(Math.max(0, Math.min(100, x)) / 25);
    const energy = Math.round(Math.max(0, Math.min(100, (38 - y) / 0.34)));
    const next = [...arcPreview];
    next[stop] = energy;
    setEnergyArc(next);
  };

  return (
    <Dialog title="How mixes get built" onClose={onClose} footer={<button className="primary" onClick={onClose}>Done</button>}>
      <p className="hint">These stay as your defaults for every new mix you build. They don’t change a mix you’ve already got. You can change any transition song by song later.</p>
      {problem && <p className="warn" role="alert">{problem}</p>}

      <section className="mix-steering" aria-label="Mix controls">
        <label htmlFor="mix-language">Transition feel</label>
        <select id="mix-language" value={mixLanguage} onChange={(event) => void chooseMixLanguage(event.target.value)}>
          <option value="balanced">Let each mix choose</option>
          <option value="seamless">Smooth blends</option>
          <option value="punchy">Punchy changes</option>
        </select>
      </section>

      <section className="mix-steering" aria-label="Stem transition controls">
        <label htmlFor="stem-frequency">Stem-assisted moves</label>
        <select id="stem-frequency" value={stemFrequency} onChange={(event) => void chooseStemFrequency(event.target.value)}>
          <option value="never">Never</option>
          <option value="sometimes">Sometimes</option>
          <option value="often">Often</option>
        </select>
        <p className="hint">Vocal rides and word hand-offs. They’re only used where the pair fits and the render passes its checks.</p>
      </section>

      <section className="energy-arc" aria-label="Energy arc controls">
        <div className="energy-arc-heading">
          <div>
            <label>Energy arc</label>
            <p className="hint">Draw the shape you’d like, or set each stop below. Selecta aims for it as closely as your songs allow.</p>
          </div>
          <button type="button" onClick={() => setEnergyArc(null)} disabled={energyArc === null}>Use each mix’s arc</button>
        </div>
        <svg
          className="energy-arc-preview"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          role="img"
          aria-label="Draw energy arc"
          onPointerDown={(event) => {
            drawArcAt(event);
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) drawArcAt(event);
          }}
        >
          
          <polyline points={arcPoints} />
          {arcPreview.map((energy, index) => <circle key={ARC_STOPS[index]} cx={index * 25} cy={38 - energy * 0.34} r="2.2" />)}
        </svg>
        <p className="hint">
          {energyArc === null ? 'Each mix uses its own shape.' : 'The bright line is what you asked for.'}
          
        </p>
        {achievedPoints && <figure className="achieved-arc">
          <svg className="energy-arc-preview" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Current mix relative energy, from start to finish"><polyline className="achieved" points={achievedPoints} /></svg>
          <figcaption className="hint">Current mix: relative energy from its quietest to its most energetic song. This uses this mix’s own range, so it is not a score against your requested arc.</figcaption>
        </figure>}
        <div className="energy-arc-stops">
          {ARC_STOPS.map((stop, index) => (
            <label key={stop}>
              <span>{stop}</span>
              <input
                aria-label={`Energy arc ${stop.toLowerCase()}`}
                type="range"
                min="0"
                max="100"
                value={arcPreview[index]}
                onChange={(event) => {
                  const next = [...arcPreview];
                  next[index] = Number(event.target.value);
                  setEnergyArc(next);
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="destination-control" aria-label="Mix destination">
        <label htmlFor="destination-search">Take me to</label>
        <input
          id="destination-search"
          type="search"
          value={destinationQuery}
          onChange={(event) => setDestinationQuery(event.target.value)}
          placeholder="Search a mix-ready song"
        />
        {destination && (
          <div className="row wrap destination-selected">
            <span>Mixes will try to finish on <b>{destination.label}</b></span>
            <Action run={() => chooseDestination(null)}>Clear destination</Action>
          </div>
        )}
        {destinationQuery.trim().length >= 2 && (
          <ul className="destination-results" aria-label="Destination songs">
            {destinationResults.map((song) => (
              <li key={song.id}>
                <Action run={() => chooseDestination(song)}>{song.title ?? 'Untitled'} — {song.artist ?? 'Unknown artist'}</Action>
              </li>
            ))}
            {destinationLoading && <li role="status" className="hint">Searching ready songs…</li>}
            {destinationFailed && <li><Problem retry={() => setDestinationAttempt((value) => value + 1)}>Couldn’t search ready songs.</Problem></li>}
            {!destinationLoading && !destinationFailed && !destinationResults.length && <li className="hint">No ready songs match yet.</li>}
          </ul>
        )}
        <p className="hint">If there’s no good way there from the rest of the mix, it finishes as near as it can. Clear it to let each mix decide.</p>
      </section>
    </Dialog>
  );
}

/** The front door. One tap plays something good, and everything can be changed afterwards. */
export function Mixes({ status, mix, mixName, player, setMixData, setView, notify, now, refreshStatus, openDraft, playDraft, tab = 'browse' }: ViewProps & { tab?: 'browse' | 'mine' }) {
  const [cards, setCards] = useState<VibeCard[] | null>(null);
  const [songs, setSongs] = useState(12);
  const [building, setBuilding] = useState('');
  const [draftsChanged, setDraftsChanged] = useState(0);
  const [problem, setProblem] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [cardsAttempt, setCardsAttempt] = useState(0);
  const [cardsFailed, setCardsFailed] = useState(false);
  const { counts } = status;

  useEffect(() => {
    let live = true;
    setCardsFailed(false);
    get<VibeCard[]>('/vibes').then((rows) => { if (live) setCards(rows); }).catch(() => { if (live) setCardsFailed(true); });
    return () => { live = false; };
  }, [counts.analysed, counts.lyrics, counts.ready, cardsAttempt]);

  const start = async (key: string, name: string, open: boolean) => {
    setBuilding(key);
    setProblem('');
    try {
      const data = await post<MixData>(`/vibes/${key}/build?count=${songs}`);
      setMixData(data);
      notify(`${name}: ${data.mix.length} songs.`, true);
      if (open) {
        setView('Edit');
      } else {
        setView('Now');
        void player.playFrom(0);
      }
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBuilding('');
    }
  };

  const keepAsDraft = async (key: string) => {
    setBuilding(key);
    setProblem('');
    try {
      const made = await post<{ id: number; name: string; count: number }>(`/vibes/${key}/build?count=${songs}&as_draft=true`);
      notify(`Saved ${made.name} as a draft, with ${made.count} songs. Nothing changed in what’s playing.`);
      setDraftsChanged((times) => times + 1);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBuilding('');
    }
  };

  const analyse = async () => {
    await post('/analysis/start');
    refreshStatus();
    notify('Analysing the rest of your library in the background.');
  };

  const hero = cards?.find((card) => card.key === 'pick');
  const ready = cards?.filter((card) => card.ready && card.key !== 'pick') ?? [];
  const waiting = cards?.filter((card) => !card.ready && card.key !== 'christmas') ?? [];
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const readinessAvailable = Number.isFinite(counts.ready);
  const readyCount = counts.ready;
  const replacing = mix.length > 0 && now.phase !== 'idle';

  if (!readinessAvailable) {
    return (
      <main className="page" id="main">
        <h1 className="display">Checking your song readiness.</h1>
        <p className="lede">
          This running Selecta server hasn’t reported how many songs have the cues needed for mixes.
          Restart Selecta to refresh this status. Audio analysis is complete for {counts.analysed};
          {left > 0 ? ` ${left} still to analyse.` : ' there are no more songs waiting for audio analysis.'}
        </p>
        <div className="row">
          <button onClick={() => setView('Workshop')}>See progress</button>
        </div>
      </main>
    );
  }

  if (readyCount < 6) {
    return (
      <main className="page" id="main">
        <h1 className="display">Getting your songs ready.</h1>
        <p className="lede">
          {readyCount} of {counts.music} songs have the vocal or instrumental cues needed for mixes. Audio analysis is complete for {counts.analysed};
          {left > 0 ? ` ${left} still to analyse.` : ' there are no more songs waiting for audio analysis.'} You can use your PC as normal while this happens.
        </p>
        <ol className="readiness-steps" aria-label="Library preparation">
          <li><span>Music found</span><strong>{counts.music}</strong></li>
          <li><span>Audio analysed</span><strong>{counts.analysed}</strong></li>
          <li><span>Ready for mixes</span><strong>{readyCount} / 6 needed</strong></li>
        </ol>
        {!left && readyCount < 6 && <p className="hint">Audio analysis is finished. More songs need timed lyrics or instrumental cues before they can mix. Open Library → Needs attention to see each song’s reason.</p>}
        <div className="row wrap">
          <button onClick={() => setView('Library')}>Open Library</button>
          {!status.analysis_running && <Action className="primary" run={analyse}>Analyse my songs</Action>}
          {status.analysis_running && <span className="pill rendering">Analysing now</span>}
          <button onClick={() => setView('Workshop')}>See progress</button>
        </div>
      </main>
    );
  }

  const tabs = (
    <nav className="tabs" aria-label="Mixes">
      <PageLink to="/mixes" aria-current={tab === 'browse' ? 'page' : undefined}>Browse</PageLink>
      <PageLink to="/mixes/mine" aria-current={tab === 'mine' ? 'page' : undefined}>My mixes</PageLink>
    </nav>
  );

  if (tab === 'mine') {
    return (
      <main className="page mixes" id="main">
        <h1 className="display small">My mixes</h1>
        {tabs}
        {mix.length > 0 && <CurrentMix mix={mix} mixName={mixName} now={now} player={player} setView={setView} />}
        <Drafts key={draftsChanged} notify={notify} openDraft={openDraft} playDraft={playDraft} setView={setView} />
      </main>
    );
  }

  return (
    <main className="page mixes" id="main">
      {mix.length > 0 && <CurrentMix mix={mix} mixName={mixName} now={now} player={player} setView={setView} />}

      <section className="hero">
        <p className="eyebrow">Tap and play</p>
        <h1 className="display">{hero?.name ?? 'Selecta’s pick'}</h1>
        <p className="lede">{hero?.blurb ?? 'The strongest run it can find through your library.'}</p>
        <div className="row wrap">
          <Action
            className="primary big"
            disabled={!hero?.ready || !!building}
            working="Building…"
            title={replacing ? `Replaces ${mixName}, which you can undo` : undefined}
            run={() => hero && start('pick', hero.name, false)}
          >
            Play
          </Action>
          <div className="chips" role="group" aria-label="How long, roughly">
            {SET_LENGTHS.map((option) => (
              <button key={option.songs} aria-pressed={songs === option.songs} onClick={() => setSongs(option.songs)}>
                About {option.label}
              </button>
            ))}
          </div>
          <button onClick={() => setCustomizing(true)}>Customize</button>
        </div>
        <p className="hint">
          {songs} songs. How long it really runs depends on where the transitions fall.
          {replacing ? ` Playing a new mix replaces ${mixName}, which you can undo. To keep it playing, use Save as draft.` : ''}
        </p>
      </section>

      {problem && <p className="warn" role="alert">{problem}</p>}

      {tabs}

      <section>
        <h2 className="section-title">Pick a feeling</h2>
        <p className="hint">Every one is built from your own songs, fresh each time you press play.</p>
        {cardsFailed && <Problem retry={() => setCardsAttempt((value) => value + 1)}>Couldn’t load mix suggestions. Try again when Selecta is available.</Problem>}
        {!cards && !cardsFailed && <Skeleton variant="cards" lines={4} label="Finding what your library can do" />}
        {GROUPS.map((group) => {
          const inGroup = ready.filter((card) => card.group === group);
          if (!inGroup.length) return null;
          return (
            <div className="vibe-group" key={group}>
              <h3 className="eyebrow">{group}</h3>
              <div className="cards">
                {inGroup.map((card) => (
                  <article className="card" key={card.key} data-vibe={card.key}>
                    <h3>{card.name}</h3>
                    <p>{card.blurb}</p>
                    <p className="artists">{card.artists.join(', ')}</p>
                    <p className="how">
                      {card.tempo ? `${card.tempo[0]}–${card.tempo[1]} BPM · ` : ''}
                      {card.moves}
                    </p>
                    <div className="row">
                      <Action className="primary" disabled={!!building} working="Building…" run={() => start(card.key, card.name, false)}>Play</Action>
                      <Action disabled={!!building} working="Building…" run={() => start(card.key, card.name, true)}>Edit first</Action>
                      <Action disabled={!!building} working="Saving…" aria-label={`Save ${card.name} as a draft`} run={() => keepAsDraft(card.key)}>Save as draft</Action>
                      <small className="soft">{card.songs} songs, up to {length(card.seconds)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {waiting.length > 0 && (
        <section className="waiting">
          <h2 className="section-title">Needs more mix-ready songs</h2>
          <p className="hint">These need songs that have been analysed and have timed lyrics or are instrumental.</p>
          <ul>
            {waiting.map((card) => (
              <li key={card.key}>
                <b>{card.name}</b> <span className="soft">needs {card.needs} more</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {left > 0 && (
        <section className="nudge">
          <p>
            <b>{counts.analysed} of {counts.music} songs have audio analysis; {counts.ready ?? 0} are ready for mixes.</b> The rest will mean more variety and word links. {analysisWords(status.eta?.analysis)}
          </p>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <Action run={analyse}>Analyse the rest</Action>
          )}
        </section>
      )}

      {customizing && <MixSetup status={status} mix={mix} refreshStatus={refreshStatus} notify={notify} onClose={() => setCustomizing(false)} />}
    </main>
  );
}

function CurrentMix({ mix, mixName, now, player, setView }: Pick<ViewProps, 'mix' | 'mixName' | 'now' | 'player' | 'setView'>) {
  return (
    <section className="carry-on">
      <div>
        <p className="eyebrow">{now.phase === 'idle' ? 'Current mix' : now.phase === 'paused' ? 'Paused' : 'Playing now'}</p>
        <h2>{mixName}</h2>
        <p className="soft">{mix.length} songs</p>
      </div>
      <div className="row wrap">
        {now.phase === 'idle' ? (
          <Action run={async () => {
            setView('Now');
            await player.togglePause();
          }}>
            Play
          </Action>
        ) : (
          <button onClick={() => setView('Now')}>Open</button>
        )}
        <button onClick={() => setView('Edit')}>Edit</button>
      </div>
    </section>
  );
}
