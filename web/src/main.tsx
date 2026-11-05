import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { get, MixItem, Status } from './api';
import { NowState, SetPlayer } from './player';
import { Library } from './views/Library';
import { Links } from './views/Links';
import { Mix } from './views/Mix';
import { Now } from './views/Now';
import { Start } from './views/Start';
import { Workshop } from './views/Workshop';
import './style.css';

export type View = 'Now' | 'Mix' | 'Library' | 'Links' | 'Workshop';
const VIEWS: View[] = ['Now', 'Mix', 'Library', 'Links', 'Workshop'];

function App() {
  const [view, setView] = useState<View>('Now');
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState('');
  const [mix, setMix] = useState<MixItem[]>([]);
  const mixRef = useRef<MixItem[]>([]);
  mixRef.current = mix;

  const refreshMix = useCallback(() => {
    get<{ mix: MixItem[] }>('/mix').then((data) => setMix(data.mix)).catch(() => {});
  }, []);
  const refreshStatus = useCallback(() => {
    get<Status>('/status')
      .then((data) => {
        setStatus(data);
        setProblem('');
      })
      .catch((error: Error) => setProblem(error.message));
  }, []);

  const player = useMemo(() => new SetPlayer(() => mixRef.current, refreshMix), [refreshMix]);
  const [now, setNow] = useState<NowState>(player.state);
  useEffect(() => {
    player.onChange = setNow;
  }, [player]);

  useEffect(() => {
    refreshStatus();
    refreshMix();
    const timer = window.setInterval(refreshStatus, 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, refreshMix]);

  // Anything still rendering gets checked often, so its status changes on its own.
  const busy = mix.some((item) => ['queued', 'rendering'].includes(item.seam?.state.status ?? ''));
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(refreshMix, 1500);
    return () => window.clearInterval(timer);
  }, [busy, refreshMix]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (now.phase === 'idle' && mixRef.current.length) void player.playFrom(0);
        else void player.togglePause();
      } else if (event.key.toLowerCase() === 'n') void player.skip();
      else if (event.key === '/') {
        event.preventDefault();
        setView('Library');
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [player, now.phase]);

  if (problem && !status) {
    return (
      <main className="page">
        <h1 className="display">Can’t reach Selecta.</h1>
        <p className="lede">{problem}</p>
      </main>
    );
  }
  if (!status) return <main className="page" aria-busy="true" />;

  if (status.counts.total === 0) {
    return <Start status={status} onChange={refreshStatus} />;
  }

  const shared = { status, mix, refreshMix, refreshStatus, player, now, setView };
  const playing = mix[now.position];
  return (
    <>
      <header className="bar">
        <button className="brand" onClick={() => setView('Now')}>
          Selecta
        </button>
        <nav aria-label="Main">
          {VIEWS.map((name) => (
            <button key={name} aria-current={view === name ? 'page' : undefined} onClick={() => setView(name)}>
              {name}
            </button>
          ))}
        </nav>
      </header>
      {view === 'Now' && <Now {...shared} />}
      {view === 'Mix' && <Mix {...shared} />}
      {view === 'Library' && <Library {...shared} />}
      {view === 'Links' && <Links {...shared} />}
      {view === 'Workshop' && <Workshop {...shared} />}
      {view !== 'Now' && playing && now.phase !== 'idle' && (
        <aside className="mini" aria-label="Now playing">
          <button className="round" onClick={() => void player.togglePause()} aria-label={now.phase === 'playing' ? 'Pause' : 'Play'}>
            {now.phase === 'playing' ? '❚❚' : '▶'}
          </button>
          <button className="mini-song" onClick={() => setView('Now')}>
            <b>{playing.title}</b>
            <span>{playing.artist}</span>
          </button>
          <button onClick={() => void player.skip()}>Skip</button>
        </aside>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
