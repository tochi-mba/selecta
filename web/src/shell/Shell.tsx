import { MouseEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { MixItem } from '../api';
import { NowState, SetPlayer } from '../player';
import { navigate, Route, savedScroll, useLocationText } from '../router';
import { LiveRegion } from '../ui/controls';
import { Icon, type IconName } from '../ui/Icon';
import { Toaster } from '../ui/toasts';

const PLACES: { path: string; label: string; page: Route['page']; mark: IconName }[] = [
  { path: '/listen', label: 'Listen', page: 'listen', mark: 'music' },
  { path: '/mixes', label: 'Mixes', page: 'mixes', mark: 'mixes' },
  { path: '/library', label: 'Library', page: 'library', mark: 'library' },
  { path: '/discover', label: 'Discover', page: 'discover', mark: 'discover' },
  { path: '/workshop', label: 'Workshop', page: 'workshop', mark: 'settings' },
];

/** An ordinary link that doesn't reload the page, so the music keeps going. */
export function PageLink({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={follow}>{children}</a>;
}

function clock(seconds: number): string {
  const whole = Math.max(Math.floor(seconds), 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function VolumeControl({ player, now }: { player: SetPlayer; now: NowState }) {
  return (
    <div className="volume">
      <button
        className="icon"
        aria-label={now.muted ? 'Turn the sound back on' : 'Mute'}
        aria-pressed={now.muted}
        onClick={() => player.toggleMute()}
      >
        <Icon name={now.muted || now.volume === 0 ? 'muted' : 'volume'} />
      </button>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={100}
        value={Math.round((now.muted ? 0 : now.volume) * 100)}
        onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
      />
    </div>
  );
}

/** The song that's playing, on every page but the one that's all about it. Shown only once there's
 * something to show, and the page makes room for it so nothing ends up underneath. */
function MiniPlayer({ player, now, song, onRequests, waiting }: { player: SetPlayer; now: NowState; song: MixItem; onRequests: () => void; waiting: number }) {
  const progress = now.duration ? Math.min(now.songTime / now.duration, 1) : 0;
  return (
    <aside className="mini" aria-label="Now playing">
      <i className="mini-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <button className="round" onClick={() => void player.togglePause()} aria-label={now.phase === 'playing' ? 'Pause' : 'Play'}>
        <Icon name={now.phase === 'playing' ? 'pause' : 'play'} />
      </button>
      <PageLink to="/listen" className="mini-song">
        <b>{song.title}</b>
        <span>{song.artist} · {clock(now.songTime)} / {clock(now.duration)}</span>
      </PageLink>
      <button className="mini-next" onClick={() => void player.next()} aria-label="Next song"><Icon name="next" /></button>
      <button className="mini-requests" onClick={onRequests} aria-label={waiting ? `Requests, ${waiting} waiting` : 'Requests'}>
        Request{waiting ? <span className="count"> {waiting}</span> : ''}
      </button>
      <div className="mini-volume"><VolumeControl player={player} now={now} /></div>
    </aside>
  );
}

export function Shell({
  route,
  player,
  now,
  song,
  showPlayer,
  hasMix,
  stage,
  waitingRequests,
  onRequests,
  onHelp,
  banner,
  children,
}: {
  route: Route;
  player: SetPlayer;
  now: NowState;
  song?: MixItem;
  showPlayer: boolean;
  hasMix: boolean;
  stage: boolean;
  waitingRequests: number;
  onRequests: () => void;
  onHelp: () => void;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const place = useLocationText().split('?')[0];
  const content = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const [popped, setPopped] = useState(false);

  useEffect(() => {
    const pop = () => setPopped(true);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  // A new page starts at the top with focus at its start. Back and Forward return to where you were.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo?.(0, popped ? savedScroll() : 0);
    setPopped(false);
    content.current?.focus({ preventScroll: true });
  }, [place]);

  const editing = route.page === 'edit';
  return (
    <div className={`shell ${stage ? 'on-stage' : ''} ${showPlayer && !stage ? 'with-player' : ''}`} ref={shell}>
      {!stage && <a className="skip-link" href="#content">Skip to the page</a>}
      {!stage && (
        <nav className="nav" aria-label="Main">
          <PageLink to="/mixes" className="brand" aria-label="Selecta, go to Mixes">Selecta</PageLink>
          <ul>
            {PLACES.map((item) => (
              <li key={item.page}>
                <PageLink to={item.path} aria-current={route.page === item.page ? 'page' : undefined}>
                  <Icon name={item.mark} />
                  <span>{item.label}</span>
                </PageLink>
              </li>
            ))}
            {hasMix && (
              <li className="nav-context">
                <PageLink to="/mix/current/edit" aria-current={editing ? 'page' : undefined}>
                  <Icon name="edit" />
                  <span>Edit</span>
                </PageLink>
              </li>
            )}
          </ul>
          <div className="nav-foot">
            <button onClick={onRequests} aria-label={waitingRequests ? `Requests, ${waitingRequests} waiting` : 'Requests'}>
              Request a song{waitingRequests ? <span className="count"> {waitingRequests}</span> : ''}
            </button>
            <button className="quiet" aria-label="Keyboard shortcuts" onClick={onHelp}><Icon name="help" /></button>
          </div>
        </nav>
      )}
      <div className="content" id="content" tabIndex={-1} ref={content}>
        {banner}
        {children}
      </div>
      {showPlayer && song && !stage && <MiniPlayer player={player} now={now} song={song} onRequests={onRequests} waiting={waitingRequests} />}
      <Toaster />
      <LiveRegion />
    </div>
  );
}
