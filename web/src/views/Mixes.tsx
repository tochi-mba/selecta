import { useEffect, useState } from 'react';
import { get, MixData, post, VibeCard } from '../api';
import { length, SET_LENGTHS } from '../lib';
import { ViewProps } from './shared';

type Saved = { name: string; songs: number };

const GROUPS = ['The moment', 'The mood', 'The sound', 'The journey'];

/** The front door. One tap plays something good, and everything can be changed afterwards. */
export function Mixes({ status, mix, mixName, player, setMixData, setView, notify, now, refreshStatus }: ViewProps) {
  const [cards, setCards] = useState<VibeCard[] | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [songs, setSongs] = useState(12);
  const [building, setBuilding] = useState('');
  const [problem, setProblem] = useState('');
  const { counts } = status;

  useEffect(() => {
    get<VibeCard[]>('/vibes').then(setCards).catch((error: Error) => setProblem(error.message));
    get<Saved[]>('/saved').then(setSaved).catch(() => {});
  }, [counts.analysed]);

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

  const hero = cards?.find((card) => card.key === 'pick');
  const ready = cards?.filter((card) => card.ready && card.key !== 'pick') ?? [];
  const waiting = cards?.filter((card) => !card.ready && card.key !== 'christmas') ?? [];
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);

  if (counts.analysed < 6) {
    return (
      <main className="page">
        <h1 className="display">Getting your songs ready.</h1>
        <p className="lede">
          {counts.analysed} of {counts.music} song{counts.music === 1 ? '' : 's'} ready. Selecta needs a few more before it can build a mix, and you
          can use your PC as normal while it works.
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
                    <p className="facts">
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
            <b>{counts.analysed} of your {counts.music} songs are ready.</b> The rest will mean better mixes and many more
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
