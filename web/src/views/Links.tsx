import { useEffect, useState } from 'react';
import { get, Link, LinkList, MixData, post, SeamState } from '../api';
import { ViewProps } from './shared';

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
      {didnt.length > 0 && (
        <details className="didnt">
          <summary>{didnt.length} didn’t work so well</summary>
          <div className="link-grid">{didnt.map(card)}</div>
        </details>
      )}
    </main>
  );
}
