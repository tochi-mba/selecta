import { useEffect, useState } from 'react';
import { get, Link, LinkList, MixData, post, SeamState } from '../api';
import { ViewProps } from './shared';

type HarmonicDiscovery = {
  id: number; song_a: number; song_b: number; title_a: string; title_b: string;
  artist_a: string; artist_b: string; status: string;
  payload: { a_at: number; b_at: number; bars: number; transpose: number };
};

export function HarmonicDiscoveries() {
  const [items, setItems] = useState<HarmonicDiscovery[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    get<HarmonicDiscovery[]>('/discoveries').then(setItems).catch(() => setError('Could not load harmonic discoveries.'));
  }, []);
  const review = async (item: HarmonicDiscovery, verdict: string) => {
    try {
      await post(`/discoveries/${item.id}/review`, { verdict });
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: verdict } : row));
      setError('');
    } catch { setError('Could not save that discovery review. Try again.'); }
  };
  return <section className="next-up">
    <h2>Harmonic discoveries</h2>
    <p className="hint">Ordered passages that may share a harmonic shape. Audition both originals from the matched cues. These are separate excerpts, not a rendered blend, and stay out of automatic sets.</p>
    {error && <p role="alert">{error}</p>}
    {!items.length && !error && <p className="hint">No harmonic candidates stored yet. Library discovery will populate this collection.</p>}
    {items.map((item) => <article className="panel" key={item.id}>
      <h3>{item.title_a} → {item.title_b}</h3>
      <p className="hint">{item.payload.bars} matched bars · comparison transposes B by {item.payload.transpose > 6 ? item.payload.transpose - 12 : item.payload.transpose} semitones. Playback below keeps the original pitch.</p>
      {[{ id: item.song_a, title: item.title_a, artist: item.artist_a, at: item.payload.a_at }, { id: item.song_b, title: item.title_b, artist: item.artist_b, at: item.payload.b_at }].map((song) => <div key={song.id}>
        <p>{song.artist} · {song.title}</p>
        <audio controls preload="none" aria-label={`Audition ${song.title}`} src={`/api/songs/${song.id}/audio`} onLoadedMetadata={(event) => { event.currentTarget.currentTime = song.at; }} />
      </div>)}
      <div className="chips" role="group" aria-label={`Review ${item.title_a} and ${item.title_b}`}>
        <button aria-pressed={item.status === 'approved'} onClick={() => void review(item, item.status === 'approved' ? 'new' : 'approved')}>Interesting connection</button>
        <button aria-pressed={item.status === 'rejected'} onClick={() => void review(item, item.status === 'rejected' ? 'new' : 'rejected')}>Doesn’t connect</button>
      </div>
    </article>)}
  </section>;
}

function LinkCard({ link, onAdd, names, onRated }: { link: Link; onAdd: (link: Link, move: string) => void; names: Record<string, string>; onRated: () => void }) {
  const [move, setMove] = useState(link.move);
  const [override, setOverride] = useState<SeamState | null>(null);
  const [playing, setPlaying] = useState(false);
  const state = override ?? link.state;
  const busy = state.status === 'queued' || state.status === 'rendering';

  useEffect(() => {
    if (!override || !['queued', 'rendering'].includes(override.status)) return;
    const timer = window.setInterval(() => {
      get<SeamState>(`/seams/${override.key}`).then(setOverride).catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [override]);

  const render = async (name: string) => {
    setMove(name);
    setPlaying(true);
    setOverride(await post<SeamState>('/seams', { a: link.a, b: link.b, move: name, phrase: link.phrase }));
  };
  const rate = async (rating: string) => {
    setOverride(await post<SeamState>(`/seams/${state.key}/rate`, { rating }));
    onRated();
  };

  return (
    <article className={`link-card ${state.status}`}>
      <h2 className="phrase">“{link.phrase}”</h2>
      <p className="handoff">
        <b>{link.title_a}</b> <span>{link.artist_a}</span>
        <q>{link.line_a}</q>
      </p>
      <p className="handoff">
        <b>{link.title_b}</b> <span>{link.artist_b}</span>
        <q>{link.line_b}</q>
      </p>
      <div className="chips" role="group" aria-label="Which move">
        {link.moves.map((name) => (
          <button key={name} aria-pressed={move === name} onClick={() => void render(name)}>
            {names[name] ?? name}
          </button>
        ))}
      </div>
      {state.status === 'failed' && <p className="warn">{state.error}</p>}
      {state.status === 'ready' && !state.passed && <p className="warn">This one has a rough spot. Hear it and decide.</p>}
      <div className="row wrap">
        {state.status === 'ready' ? (
          <button className="primary" onClick={() => setPlaying(!playing)}>{playing ? 'Hide' : 'Play it'}</button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => void render(move)}>
            {busy ? 'Rendering…' : state.status === 'failed' ? 'Try again' : 'Render it now'}
          </button>
        )}
        <button onClick={() => onAdd(link, move)}>Add both to the mix</button>
        {state.status === 'ready' && (
          <span className="pair" role="group" aria-label="Rate this link">
            <button aria-pressed={state.rating === 'good'} onClick={() => void rate('good')}>Good</button>
            <button aria-pressed={state.rating === 'bad'} onClick={() => void rate('bad')}>Bad</button>
          </span>
        )}
      </div>
      {state.status === 'ready' && playing && (
        <audio
          controls
          autoPlay
          className="preview"
          src={`/api/seams/${state.key}/preview`}
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = Math.max(0, (state.preview_seam ?? 0) - 8);
          }}
        />
      )}
    </article>
  );
}

export function Links({ mix, setMixData, setView, notify, status }: ViewProps) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<LinkList | null>(null);

  const load = () =>
    get<LinkList>(`/links?q=${encodeURIComponent(query)}&limit=60`)
      .then(setData)
      .catch(() => setData({ links: [], prepared: 0, preparing: 0 }));

  useEffect(() => {
    const wait = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(wait);
  }, [query]);

  // Selecta prepares links in spare time, so finished ones appear as they land.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(timer);
  }, [query]);

  const add = async (link: Link, move: string) => {
    const start = mix.length;
    await post('/mix/songs', { song_id: link.a });
    await post('/mix/songs', { song_id: link.b });
    await post(`/mix/${start + 1}/seam`, { move, phrase: link.phrase });
    await post(`/mix/${start + 1}/render`);
    setMixData(await get<MixData>('/mix'));
    notify(`Added “${link.phrase}” to your mix.`, true);
    setView('Edit');
  };

  const worked = data?.links.filter((link) => link.worked) ?? [];
  const didnt = data?.links.filter((link) => !link.worked) ?? [];
  const card = (link: Link) => (
    <LinkCard
      key={`${link.phrase}-${link.a}-${link.b}`}
      link={link}
      names={status.moves}
      onAdd={(l, m) => void add(l, m)}
      onRated={() => void load()}
    />
  );

  return (
    <main className="page">
      <h1 className="display small">Words your songs share</h1>
      <p className="lede">
        One song ends a line on these words, another opens a line with them, and the music fits too. Selecta prepares the
        best ones in the background, so they’re ready to play.
      </p>
      {data && data.preparing > 0 && (
        <p className="hint" role="status">
          {data.prepared} of the best {data.preparing} are ready. Your mix always renders first.{data.prepared < data.preparing ? ' More are on the way.' : ''}
        </p>
      )}
      <input
        className="wide"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Look for a word, like night or love"
        aria-label="Search shared words"
      />
      {data === null && <p className="hint">Searching your lyrics…</p>}
      {data?.links.length === 0 && (
        <p className="lede">{query ? `No links on “${query}” yet.` : 'No links yet. Analysing more songs will find more.'}</p>
      )}
      <div className="link-grid">{worked.map(card)}</div>
      <HarmonicDiscoveries />
      {didnt.length > 0 && (
        <details className="didnt">
          <summary>{didnt.length} didn’t work so well</summary>
          <div className="link-grid">{didnt.map(card)}</div>
        </details>
      )}
    </main>
  );
}
