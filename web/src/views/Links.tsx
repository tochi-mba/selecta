import { useEffect, useRef, useState } from 'react';
import { get, Link, LinkList, MixData, post, SeamState } from '../api';
import { ViewProps } from './shared';

type HarmonicDiscovery = {
  id: number; song_a: number; song_b: number; title_a: string; title_b: string;
  artist_a: string; artist_b: string; status: string;
  payload: { a_at: number; b_at: number; a_end?: number; b_end?: number; bars: number; transpose: number };
};

type Excerpt = { key: string; src: string; at: number; end: number };

const EXCERPT_SECONDS = 20;
const SHOWN_AT_ONCE = 5;

function excerptOf(id: number, at: number, end: number | undefined, key: string): Excerpt {
  return { key, src: `/api/songs/${id}/audio`, at, end: end ?? at + EXCERPT_SECONDS };
}

/** Best first, but a song that's already come up waits its turn, so the list isn't one song. */
function spreadOut(items: HarmonicDiscovery[]): HarmonicDiscovery[] {
  const seen = new Set<number>();
  const fresh: HarmonicDiscovery[] = [];
  const again: HarmonicDiscovery[] = [];
  for (const item of items) {
    const repeat = seen.has(item.song_a) || seen.has(item.song_b);
    (repeat ? again : fresh).push(item);
    seen.add(item.song_a);
    seen.add(item.song_b);
  }
  return [...fresh, ...again];
}

/** Songs that may share a chord pattern, for a person to judge by ear. Each song's matching part
 * plays by itself, with no need to find the place or stop it. Nothing here goes into a mix. */
export function HarmonicDiscoveries({ onListen }: { onListen?: () => void }) {
  const [items, setItems] = useState<HarmonicDiscovery[]>([]);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const queue = useRef<Excerpt[]>([]);
  const current = useRef<Excerpt | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => get<HarmonicDiscovery[]>('/discoveries').then((rows) => {
      if (live) { setItems(rows); setError(''); }
    }).catch(() => { if (live) setError('Couldn’t load these. Try again in a moment.'); });
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const stop = () => {
    queue.current = [];
    current.current = null;
    audio.current?.pause();
    setPlaying('');
  };
  const playNext = () => {
    const next = queue.current.shift();
    if (!next || !audio.current) return stop();
    current.current = next;
    setPlaying(next.key);
    audio.current.src = next.src;
    void audio.current.play()?.catch(() => {});
  };
  const listen = (excerpts: Excerpt[]) => {
    onListen?.();
    queue.current = excerpts;
    playNext();
  };
  const review = async (item: HarmonicDiscovery, verdict: string) => {
    if (playing.startsWith(`${item.id}-`)) stop();
    try {
      await post(`/discoveries/${item.id}/review`, { verdict });
      setItems((rows) => rows.map((row) => (row.id === item.id ? { ...row, status: verdict } : row)));
      setError('');
    } catch {
      setError('Couldn’t save that. Try again.');
    }
  };

  const waiting = spreadOut(items.filter((item) => item.status === 'new'));
  const answered = items.filter((item) => item.status !== 'new');
  if (!items.length && !error) return null;
  const shown = showAll ? waiting : waiting.slice(0, SHOWN_AT_ONCE);
  return (
    <details className="next-up discoveries" onToggle={(event) => { if (!event.currentTarget.open) stop(); }}>
      <summary>
        <h2>Songs that might share chords</h2>
        <span className="hint">{waiting.length} to listen to</span>
      </summary>
      <p className="hint">
        Selecta thinks these parts use the same chord pattern. Play them and see if you hear it. They won’t go into a mix.
      </p>
      {error && <p role="alert" className="warn">{error}</p>}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audio}
        preload="none"
        data-testid="excerpt-player"
        onLoadedMetadata={(event) => {
          if (current.current) event.currentTarget.currentTime = current.current.at;
        }}
        onTimeUpdate={(event) => {
          if (current.current && event.currentTarget.currentTime >= current.current.end) playNext();
        }}
        onEnded={playNext}
      />
      {shown.map((item) => {
        const first = excerptOf(item.song_a, item.payload.a_at, item.payload.a_end, `${item.id}-a`);
        const second = excerptOf(item.song_b, item.payload.b_at, item.payload.b_end, `${item.id}-b`);
        const parts = [
          { excerpt: first, title: item.title_a, artist: item.artist_a },
          { excerpt: second, title: item.title_b, artist: item.artist_b },
        ];
        const steps = item.payload.transpose > 6 ? 12 - item.payload.transpose : item.payload.transpose;
        return (
          <article className="discovery" key={item.id}>
            <div className="discovery-parts">
              {parts.map(({ excerpt, title, artist }) => (
                <button
                  key={excerpt.key}
                  className="discovery-part"
                  aria-pressed={playing === excerpt.key}
                  onClick={() => (playing === excerpt.key ? stop() : listen([excerpt]))}
                >
                  <span aria-hidden="true">{playing === excerpt.key ? '■' : '▶'}</span>
                  <span>
                    <b>{title}</b>
                    <small>{artist}</small>
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => listen([first, second])}>Play one after the other</button>
            {steps !== 0 && (
              <p className="hint">They’re in different keys, so listen for the pattern rather than the exact notes.</p>
            )}
            <div className="row wrap" role="group" aria-label={`Do ${item.title_a} and ${item.title_b} sound connected?`}>
              <span>Hear a connection?</span>
              <button onClick={() => void review(item, 'approved')}>Yes</button>
              <button onClick={() => void review(item, 'rejected')}>No</button>
            </div>
          </article>
        );
      })}
      {waiting.length > shown.length && (
        <button onClick={() => setShowAll(true)}>Show {waiting.length - shown.length} more</button>
      )}
      {waiting.length === 0 && items.length > 0 && <p className="hint">You’ve listened to them all.</p>}
      {answered.length > 0 && (
        <details className="didnt">
          <summary>{answered.length} you’ve answered</summary>
          <ul className="answered">
            {answered.map((item) => (
              <li key={item.id}>
                <span>
                  {item.title_a} and {item.title_b}: {item.status === 'approved' ? 'connected' : 'not connected'}
                </span>
                <button onClick={() => void review(item, 'new')}>Change</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </details>
  );
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

export function Links({ mix, setMixData, setView, notify, status, now, player }: ViewProps) {
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
      <HarmonicDiscoveries
        onListen={() => {
          if (now.phase === 'playing') void player.togglePause();
        }}
      />
      {didnt.length > 0 && (
        <details className="didnt">
          <summary>{didnt.length} didn’t work so well</summary>
          <div className="link-grid">{didnt.map(card)}</div>
        </details>
      )}
    </main>
  );
}
