import { useEffect, useState } from 'react';
import { get, Link, post, SeamState } from '../api';
import { ViewProps } from './shared';

const MOVE_NAMES: Record<string, string> = {
  word_blend: 'Word blend',
  word_exchange: 'Call and response',
  phrase_roll: 'Phrase roll',
  word_cut: 'Word cut',
};

function LinkCard({ link, onAdd }: { link: Link; onAdd: (link: Link, move: string) => void }) {
  const [move, setMove] = useState(link.moves[0] ?? 'word_cut');
  const [state, setState] = useState<SeamState | null>(null);

  useEffect(() => {
    if (!state || !['queued', 'rendering'].includes(state.status)) return;
    const timer = window.setInterval(() => {
      get<SeamState>(`/seams/${state.key}`).then(setState).catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [state]);

  const hear = async () => {
    setState(await post<SeamState>('/seams', { a: link.a, b: link.b, move, phrase: link.phrase }));
  };

  return (
    <article className="link-card">
      <h2 className="phrase">“{link.phrase}”</h2>
      <p className="handoff">
        <b>{link.title_a}</b> <span>{link.artist_a}</span>
        <q>{link.line_a}</q>
      </p>
      <p className="handoff">
        <b>{link.title_b}</b> <span>{link.artist_b}</span>
        <q>{link.line_b}</q>
      </p>
      <div className="chips">
        {link.moves.filter((name) => MOVE_NAMES[name]).map((name) => (
          <button key={name} aria-pressed={move === name} onClick={() => setMove(name)}>
            {MOVE_NAMES[name]}
          </button>
        ))}
      </div>
      <div className="row wrap">
        <button
          className="primary"
          onClick={() => void hear()}
          disabled={state?.status === 'queued' || state?.status === 'rendering'}
        >
          {state?.status === 'queued' || state?.status === 'rendering' ? 'Rendering…' : 'Hear it'}
        </button>
        <button onClick={() => onAdd(link, move)}>Add both to the mix</button>
      </div>
      {state?.status === 'failed' && <p className="warn">{state.error}</p>}
      {state?.status === 'ready' && (
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

export function Links({ refreshMix, setView, mix }: ViewProps) {
  const [query, setQuery] = useState('');
  const [links, setLinks] = useState<Link[] | null>(null);

  useEffect(() => {
    const wait = window.setTimeout(() => {
      get<Link[]>(`/links?q=${encodeURIComponent(query)}&limit=40`).then(setLinks).catch(() => setLinks([]));
    }, 200);
    return () => window.clearTimeout(wait);
  }, [query]);

  const add = async (link: Link, move: string) => {
    const start = mix.length;
    await post('/mix/songs', { song_id: link.a });
    await post('/mix/songs', { song_id: link.b });
    await post(`/mix/${start + 1}/seam`, { move, phrase: link.phrase });
    await post(`/mix/${start + 1}/render`);
    refreshMix();
    setView('Mix');
  };

  return (
    <main className="page">
      <h1 className="display small">Words your songs share</h1>
      <p className="lede">
        One song ends a line on these words, and another opens a line with them, and the music fits too. Try one, and
        add it to your mix if you like it.
      </p>
      <input
        className="wide"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Look for a word, like night or love"
        aria-label="Search shared words"
      />
      {links === null && <p className="hint">Searching your lyrics…</p>}
      {links?.length === 0 && <p className="lede">No links match. Analysing more songs will find more.</p>}
      <div className="link-grid">
        {links?.map((link) => <LinkCard key={`${link.phrase}-${link.a}-${link.b}`} link={link} onAdd={(l, m) => void add(l, m)} />)}
      </div>
    </main>
  );
}
