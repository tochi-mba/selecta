import { type PointerEvent, useEffect, useState } from 'react';
import { get, MixData, post, SongRow, VibeCard } from '../api';
import { length, SET_LENGTHS } from '../lib';
import { ViewProps } from './shared';

type Saved = { name: string; songs: number };

const GROUPS = ['The moment', 'The mood', 'The sound', 'The journey'];
const ARC_STOPS = ['Start', 'Early', 'Middle', 'Late', 'Finish'];
const DEFAULT_ARC = [62, 72, 100, 85, 68];

/** The front door. One tap plays something good, and everything can be changed afterwards. */
export function Mixes({ status, mix, mixName, player, setMixData, setView, notify, now, refreshStatus }: ViewProps) {
  const [cards, setCards] = useState<VibeCard[] | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [songs, setSongs] = useState(12);
  const [building, setBuilding] = useState('');
  const [problem, setProblem] = useState('');
  const [mixLanguage, setMixLanguage] = useState(status.steering.mix_language);
  const [stemFrequency, setStemFrequency] = useState(status.steering.stems);
  const [energyArc, setEnergyArc] = useState<number[] | null>(status.steering.energy_arc);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationResults, setDestinationResults] = useState<SongRow[]>([]);
  const [destination, setDestination] = useState<{ id: string; label: string } | null>(
    status.steering.target
      ? {
          id: status.steering.target,
          label: status.steering.target_label ?? `Song ${status.steering.target}`,
        }
      : null,
  );
  const { counts } = status;

  useEffect(() => {
    get<VibeCard[]>('/vibes').then(setCards).catch((error: Error) => setProblem(error.message));
    get<Saved[]>('/saved').then(setSaved).catch(() => {});
  }, [counts.analysed, counts.lyrics, counts.ready]);

  useEffect(() => setMixLanguage(status.steering.mix_language), [status.steering.mix_language]);
  useEffect(() => setStemFrequency(status.steering.stems), [status.steering.stems]);
  useEffect(() => {
    if (JSON.stringify(energyArc) === JSON.stringify(status.steering.energy_arc)) return;
    const timer = window.setTimeout(() => {
      post('/steer', { action: 'energy_arc', value: energyArc })
        .then(() => refreshStatus())
        .catch((error: Error) => setProblem(error.message));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [energyArc, refreshStatus, status.steering.energy_arc]);
  useEffect(() => {
    setDestination(
      status.steering.target
        ? {
            id: status.steering.target,
            label: status.steering.target_label ?? `Song ${status.steering.target}`,
          }
        : null,
    );
  }, [status.steering.target, status.steering.target_label]);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (query.length < 2) {
      setDestinationResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      get<SongRow[]>(`/songs?q=${encodeURIComponent(query)}&state=ready&limit=20`)
        .then((rows) =>
          setDestinationResults(
            rows.filter(
              (row) => !row.never && ['synced', 'instrumental'].includes(row.lyric_status ?? ''),
            ),
          ),
        )
        .catch(() => setDestinationResults([]));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [destinationQuery]);

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

  const openSaved = async (name: string, play: boolean) => {
    const data = await post<MixData>('/saved/load', { name });
    setMixData(data);
    notify(`Opened ${name}.`, true);
    if (play) {
      setView('Now');
      void player.playFrom(0);
    } else {
      setView('Edit');
    }
  };

  const remove = async (name: string) => {
    setSaved(await post<Saved[]>('/saved/delete', { name }));
    notify(`Deleted ${name}.`);
  };

  const analyse = async () => {
    await post('/analysis/start');
    refreshStatus();
    notify('Analysing the rest of your library in the background.');
  };

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
    const next = song
      ? { id: String(song.id), label: `${song.title ?? 'Untitled'} — ${song.artist ?? 'Unknown artist'}` }
      : null;
    setDestination(next);
    try {
      await post('/steer', { action: 'take_me_to', value: next?.id ?? '' });
      setDestinationQuery('');
      setDestinationResults([]);
      refreshStatus();
      if (next) notify(`Future mixes will land on ${next.label}.`);
      else notify('Selecta will choose the ending again.');
    } catch (error) {
      setDestination(previous);
      setProblem((error as Error).message);
    }
  };

  const hero = cards?.find((card) => card.key === 'pick');
  const ready = cards?.filter((card) => card.ready && card.key !== 'pick') ?? [];
  const waiting = cards?.filter((card) => !card.ready && card.key !== 'christmas') ?? [];
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const readyCount = counts.ready ?? 0;
  const arcPreview = energyArc ?? DEFAULT_ARC;
  const arcPoints = arcPreview.map((energy, index) => `${index * 25},${38 - energy * 0.34}`).join(' ');
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

  if (readyCount < 6) {
    return (
      <main className="page">
        <h1 className="display">Getting your songs ready.</h1>
        <p className="lede">
          {readyCount} of {counts.music} songs have the vocal or instrumental cues needed for mixes. Audio analysis is complete for {counts.analysed};
          {left > 0 ? ` ${left} still to analyse.` : ' there are no more songs waiting for audio analysis.'} You can use your PC as normal while Selecta works.
        </p>
        <div className="row">
          {!status.analysis_running && (
            <button className="primary" onClick={() => void analyse()}>
              Analyse my songs
            </button>
          )}
          {status.analysis_running && <span className="pill rendering">Analysing now</span>}
          <button onClick={() => setView('Workshop')}>See progress</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page mixes">
      <section className="hero">
        <p className="eyebrow">Tap and play</p>
        <h1 className="display">{hero?.name ?? 'Selecta’s pick'}</h1>
        <p className="lede">{hero?.blurb ?? 'The strongest run it can find through your library.'}</p>
        <div className="row wrap">
          <button
            className="primary big"
            disabled={!hero?.ready || !!building}
            onClick={() => hero && void start('pick', hero.name, false)}
          >
            {building === 'pick' ? 'Building…' : 'Play'}
          </button>
          <div className="chips" role="group" aria-label="How long">
            {SET_LENGTHS.map((option) => (
              <button key={option.songs} aria-pressed={songs === option.songs} onClick={() => setSongs(option.songs)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mix-steering" aria-label="Mix controls">
        <label htmlFor="mix-language">Transition feel</label>
        <select id="mix-language" value={mixLanguage} onChange={(event) => void chooseMixLanguage(event.target.value)}>
          <option value="balanced">Let each mix choose</option>
          <option value="seamless">Smooth blends</option>
          <option value="punchy">Punchy changes</option>
        </select>
        <p className="hint">This guides new mixes. You can still change any transition song by song.</p>
      </section>

      <section className="mix-steering" aria-label="Stem transition controls">
        <label htmlFor="stem-frequency">Stem-assisted moves</label>
        <select
          id="stem-frequency"
          value={stemFrequency}
          onChange={(event) => void chooseStemFrequency(event.target.value)}
        >
          <option value="never">Never</option>
          <option value="sometimes">Sometimes</option>
          <option value="often">Often</option>
        </select>
        <p className="hint">
          This steers vocal rides and word hand-offs in new mixes. Selecta uses them only where the pair fits and the render passes its checks.
        </p>
      </section>

      <section className="energy-arc" aria-label="Energy arc controls">
        <div className="energy-arc-heading">
          <div>
            <label>Energy arc</label>
            <p className="hint">
              Draw the curve or fine-tune five stops. Selecta uses your shape to choose song order.
            </p>
          </div>
          <button type="button" onClick={() => setEnergyArc(null)} disabled={energyArc === null}>
            Use each mix’s arc
          </button>
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
          {arcPreview.map((energy, index) => (
            <circle key={ARC_STOPS[index]} cx={index * 25} cy={38 - energy * 0.34} r="2.2" />
          ))}
        </svg>
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
        <p className="hint">Changes save automatically. Reset to let each mix choose its own energy shape.</p>
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
            <span>Mixes will build toward <b>{destination.label}</b></span>
            <button onClick={() => void chooseDestination(null)}>Clear destination</button>
          </div>
        )}
        {destinationQuery.trim().length >= 2 && (
          <ul className="destination-results" aria-label="Destination songs">
            {destinationResults.map((song) => (
              <li key={song.id}>
                <button onClick={() => void chooseDestination(song)}>
                  {song.title ?? 'Untitled'} — {song.artist ?? 'Unknown artist'}
                </button>
              </li>
            ))}
            {!destinationResults.length && <li className="hint">No ready songs match yet.</li>}
          </ul>
        )}
        <p className="hint">Selecta will plan a route and finish on your chosen song. Clear it to let each mix decide.</p>
      </section>

      {problem && <p className="warn" role="alert">{problem}</p>}

      {mix.length > 0 && (
        <section className="carry-on">
          <div>
            <p className="eyebrow">{now.phase === 'idle' ? 'Carry on' : 'Playing now'}</p>
            <h2>{mixName}</h2>
            <p className="soft">{mix.length} songs</p>
          </div>
          <div className="row wrap">
            {now.phase === 'idle' ? (
              <button onClick={() => {
                setView('Now');
                void player.togglePause();
              }}>
                Play
              </button>
            ) : (
              <button onClick={() => setView('Now')}>Open</button>
            )}
            <button onClick={() => setView('Edit')}>Edit</button>
          </div>
        </section>
      )}

      {saved.length > 0 && (
        <section>
          <h2 className="section-title">Your saved mixes</h2>
          <ul className="saved">
            {saved.map((item) => (
              <li key={item.name}>
                <div>
                  <b>{item.name}</b>
                  <span className="soft"> {item.songs} songs</span>
                </div>
                <div className="row">
                  <button onClick={() => void openSaved(item.name, true)}>Play</button>
                  <button onClick={() => void openSaved(item.name, false)}>Edit</button>
                  <button aria-label={`Delete ${item.name}`} onClick={() => void remove(item.name)}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title">Pick a feeling</h2>
        <p className="hint">Every one is built from your own songs, fresh each time you press play.</p>
        {!cards && <div className="cards" aria-busy="true" key="loading"><div className="card ghost" /><div className="card ghost" /><div className="card ghost" /></div>}
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
                <button className="primary" disabled={!!building} onClick={() => void start(card.key, card.name, false)}>
                  {building === card.key ? 'Building…' : 'Play'}
                </button>
                <button disabled={!!building} onClick={() => void start(card.key, card.name, true)}>
                  Edit first
                </button>
                      <small className="soft">
                        {card.songs} songs, up to {length(card.seconds)}
                      </small>
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
          <h2 className="section-title">Needs more analysed songs</h2>
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
            <b>{counts.analysed} of {counts.music} songs have audio analysis; {counts.ready ?? 0} are ready for mixes.</b> The rest will mean better mixes and many more
            word links. It takes about {Math.ceil((left * 25) / 3600)} hour{left * 25 > 3600 ? 's' : ''} in the background.
          </p>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <button onClick={() => void analyse()}>Analyse the rest</button>
          )}
        </section>
      )}
    </main>
  );
}
