import { ReactNode, useEffect, useRef, useState } from 'react';
import { MixItem } from '../api';
import { useFlags } from '../flags';
import { NowState, SetPlayer } from '../player';
import { Route, savedScroll, useLocationText } from '../router';
import { setPrefs, usePrefs } from '../state/prefs';
import { useUnseenActivity } from '../state/activity';
import { jobAttention, useJobsStatus } from '../state/jobs';
import { announce, Drawer, LiveRegion } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { ThemeMenu } from '../ui/ThemeChoice';
import { Toaster } from '../ui/toasts';
import { aboutOf, classicDestinations, describeRoute, DESTINATIONS, destinationOf, workspaceTabs } from './manifest';
import { PageLink } from './PageLink';

export { PageLink };

export function clock(seconds: number): string {
  // A seek, loading transition or missing duration must never render NaN/Infinity
  // into the fixed mini-player or alter the transport's layout.
  const whole = Number.isFinite(seconds) ? Math.max(Math.floor(seconds), 0) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function VolumeControl({ player, now }: { player: SetPlayer; now: NowState }) {
  return (
    <div className="volume">
      <button
        className="icon"
        aria-label={now.volume === 0 ? 'Restore sound at 50 percent' : now.muted ? 'Unmute' : 'Mute'}
        aria-pressed={now.muted || now.volume === 0}
        onClick={() => player.toggleMute()}
      >
        <Icon name={now.muted || now.volume === 0 ? 'muted' : 'volume'} />
      </button>
      <input
        type="range"
        aria-label="Volume"
        aria-valuetext={now.muted ? 'Muted' : now.volume === 0 ? 'Silent, 0 percent' : `${Math.round(now.volume * 100)} percent`}
        min={0}
        max={100}
        value={Math.round((now.muted ? 0 : now.volume) * 100)}
        onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
      />
    </div>
  );
}

/** The song that's playing, on every page but the one that's all about it. It only presents the
 * player. The player itself lives above every page, so nothing here can start or stop the music by
 * appearing or going away. */
function MiniPlayer({ player, now, song, hasNext, onRequests, waiting }: { player: SetPlayer; now: NowState; song: MixItem; hasNext: boolean; onRequests: () => void; waiting: number }) {
  const progress = now.duration > 0 && Number.isFinite(now.songTime) ? Math.min(Math.max(now.songTime / now.duration, 0), 1) : 0;
  const on = useFlags();
  return (
    <aside className="mini" aria-label={now.inSeam ? 'Playing transition' : now.phase === 'paused' ? 'Paused playback' : now.phase === 'loading' ? 'Loading playback' : 'Now playing'}>
      <i className="mini-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <button className="round" disabled={now.phase === 'loading'} aria-busy={now.phase === 'loading'} onClick={() => void player.togglePause()} aria-label={now.phase === 'playing' ? 'Pause' : now.phase === 'loading' ? 'Loading song' : now.phase === 'paused' ? 'Resume' : 'Play'}>
        <Icon name={now.phase === 'playing' ? 'pause' : 'play'} />
      </button>
      <PageLink to="/listen" className="mini-song" title={`${song.title || 'Untitled'} - ${song.artist || 'Unknown artist'}`}>
        <b title={song.title} dir="auto">{song.title || 'Untitled'}</b>
        <span title={song.artist} dir="auto">{song.artist || 'Unknown artist'} · {clock(now.songTime)} / {clock(now.duration)}{now.inSeam ? ' · Transition playing' : ''}</span>
      </PageLink>
      <button className="mini-next" disabled={now.phase === 'loading' || !hasNext} onClick={() => void player.next()} aria-label="Next song"><Icon name="next" /></button>
      {on('requests') && (
        <button className="mini-requests" onClick={onRequests} aria-label={waiting ? `Requests, ${waiting} waiting` : 'Requests'}>
          Request<span className="count" aria-hidden={!waiting}>{waiting || '\u00a0'}</span>
        </button>
      )}
      <div className="mini-volume"><VolumeControl player={player} now={now} /></div>
    </aside>
  );
}

/** Where this page sits, and the things you can reach from anywhere. */
function ContextBar({ route, onCommands, onActivity, onHelp, onRequests, waiting, palette }: { route: Route; onCommands: () => void; onActivity: () => void; onHelp: () => void; onRequests: () => void; waiting: number; palette: boolean }) {
  const { crumbs } = describeRoute(route);
  const unseen = useUnseenActivity();
  const { jobs } = useJobsStatus();
  const attention = jobAttention(jobs);
  const on = useFlags();
  return (
    <header className="context-bar">
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((crumb, index) => (
            <li key={crumb.label}>
              {crumb.path && index < crumbs.length - 1
                ? <PageLink to={crumb.path}>{crumb.label}</PageLink>
                : <span aria-current="page">{crumb.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <div className="context-actions">
        {palette && on('app.command_palette') && (
          <button className="context-button palette-button" onClick={onCommands} aria-label="Search and commands" title="Search and commands (Ctrl K)">
            <Icon name="search" /><span className="context-label">Search</span><kbd className="context-label">Ctrl K</kbd>
          </button>
        )}
        {on('requests') && (
          <button className="context-button context-request" onClick={onRequests} aria-label={waiting ? `Requests, ${waiting} waiting` : 'Requests'}>
            <Icon name="request" />{waiting ? <span className="count">{waiting}</span> : null}
          </button>
        )}
        {on('app.theme_choice') && <ThemeMenu />}
        {on('app.activity') && (
          <button className="context-button" onClick={onActivity} aria-label={unseen ? `Activity, ${unseen} new` : 'Activity'} title="Activity and Undo">
            <Icon name="bell" />{unseen ? <span className="count">{unseen}</span> : null}
          </button>
        )}
        {attention > 0 && (
          <PageLink className="context-button health-attention" to="/workshop" aria-label={`Workspace, ${attention} ${attention === 1 ? 'item needs' : 'items need'} your attention`} title="Workspace needs your attention">
            <Icon name="warning" /><span className="count">{attention}</span>
          </PageLink>
        )}
        {on('app.shortcuts') && <button className="context-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onHelp}><Icon name="help" /></button>}
      </div>
    </header>
  );
}

/** Keeps everything fixed to the bottom above an on-screen keyboard, or out of its way, by working out
 * how much of the window the keyboard is covering. */
function useKeyboardInset() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    let keyboardWasOpen = false;
    let focusFrame = 0;
    const measure = () => {
      const covered = Math.max(window.innerHeight - view.height - view.offsetTop, 0);
      const focused = document.activeElement as HTMLElement | null;
      const editing = !!focused?.matches('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]');
      // The visual viewport also shrinks on pinch zoom. Only a focused editor
      // may invoke keyboard-yield, otherwise zoom can incorrectly hide navigation.
      const keyboardOpen = editing && covered > 120 && view.scale <= 1.1;
      root.style.setProperty('--keyboard-inset', `${Math.round(keyboardOpen ? covered : 0)}px`);
      if (keyboardOpen) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
      if (keyboardOpen && !keyboardWasOpen) {
        // Let the new viewport/insets settle before revealing the active form control.
        const focused = document.activeElement as HTMLElement | null;
        if (focused?.matches('input, textarea, select, [contenteditable="true"]')) {
          focusFrame = window.requestAnimationFrame(() => {
            if (focused.isConnected) focused.scrollIntoView({ block: 'nearest' });
          });
        }
      }
      keyboardWasOpen = keyboardOpen;
    };
    measure();
    view.addEventListener('resize', measure);
    view.addEventListener('scroll', measure);
    return () => {
      view.removeEventListener('resize', measure);
      view.removeEventListener('scroll', measure);
      window.cancelAnimationFrame(focusFrame);
      root.style.removeProperty('--keyboard-inset');
      delete root.dataset.keyboard;
    };
  }, []);
}

export function Shell({
  route,
  player,
  now,
  song,
  showPlayer,
  hasMix,
  hasNext,
  stage,
  waitingRequests,
  onRequests,
  onHelp,
  onCommands = () => {},
  onActivity = () => {},
  banner,
  children,
}: {
  route: Route;
  player: SetPlayer;
  now: NowState;
  song?: MixItem;
  showPlayer: boolean;
  hasMix: boolean;
  hasNext?: boolean;
  stage: boolean;
  waitingRequests: number;
  onRequests: () => void;
  onHelp: () => void;
  onCommands?: () => void;
  onActivity?: () => void;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const place = useLocationText().split('?')[0];
  const content = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const [popped, setPopped] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const prefs = usePrefs();
  const on = useFlags();
  useKeyboardInset();

  useEffect(() => {
    const pop = () => setPopped(true);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  // A new page starts at the top with focus at its start, and says where you are. Back and Forward
  // return to where you were.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo?.(0, popped ? savedScroll() : 0);
    setPopped(false);
    content.current?.focus({ preventScroll: true });
    announce(`${describeRoute(route).title} page`);
  }, [place]);

  // the shape of the frame lives in one place, on the root, so everything is measured from the same numbers
  const withPlayer = showPlayer && !!song && !stage;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.player = withPlayer ? 'on' : 'off';
    root.dataset.rail = prefs.railCollapsed ? 'collapsed' : 'open';
    if (stage) root.dataset.stage = 'on';
    else delete root.dataset.stage;
  }, [withPlayer, prefs.railCollapsed, stage]);

  const editing = route.page === 'edit';
  const here = destinationOf(route);
  const collapsed = prefs.railCollapsed;
  const primaryDestinations = DESTINATIONS.filter((item) => item.id !== 'workspace');
  const workspace = DESTINATIONS.find((item) => item.id === 'workspace');
  const classic = prefs.classicNav && on('app.classic_nav');
  return (
    <div className={`shell ${stage ? 'on-stage' : ''} ${withPlayer ? 'with-player' : ''}`}>
      {!stage && <a className="skip-link" href="#content">Skip to the page</a>}
      {!stage && (
        <nav className="nav" aria-label="Main">
          <PageLink to="/mixes" className="brand" aria-label="Selecta, go to Make a Mix"><span className="brand-word">Selecta</span><span className="brand-mark" aria-hidden="true">S</span></PageLink>
          <ul>
            {classic
              ? classicDestinations().map((item) => (
                  <li key={item.path}>
                    <PageLink to={item.path} data-tip={item.label} aria-current={item.pages.includes(route.page) && !editing ? 'page' : undefined}>
                      <Icon name={item.icon} />
                      <span className="nav-label">{item.label}</span>
                    </PageLink>
                  </li>
                ))
              : primaryDestinations.map((item) => (
                  <li key={item.id}>
                    <PageLink to={item.path} data-tip={item.label} aria-current={here === item.id && !editing ? 'page' : here === item.id ? 'true' : undefined}>
                      <Icon name={item.icon} />
                      <span className="nav-label">{item.label}</span>
                    </PageLink>
                  </li>
                ))}
            {!classic && workspace && (
              <li className="nav-more">
                <PageLink className="nav-more-desktop" to={workspace.path} data-tip={workspace.label} aria-current={here === workspace.id ? 'page' : undefined}>
                  <Icon name={workspace.icon} />
                  <span className="nav-label">{workspace.label}</span>
                </PageLink>
                <button className="nav-more-mobile" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={here === workspace.id ? 'page' : undefined} onClick={() => setMoreOpen(true)}>
                  <Icon name={workspace.icon} />
                  <span className="nav-label">More</span>
                </button>
              </li>
            )}
            {hasMix && on('editor') && (
              <li className="nav-context">
                <PageLink to="/mix/current/edit" data-tip="Edit" aria-current={editing ? 'page' : undefined}>
                  <Icon name="edit" />
                  <span className="nav-label">Edit</span>
                </PageLink>
              </li>
            )}
          </ul>
          <div className="nav-foot">
            {on('requests') && (
              <button className="nav-request" onClick={onRequests} aria-label={waitingRequests ? `Requests, ${waitingRequests} waiting` : 'Requests'} title={on('app.shortcuts') ? 'Request a song (R)' : 'Request a song'}>
                <Icon name="request" /><span className="nav-label">Request a song</span>{waitingRequests ? <span className="count"> {waitingRequests}</span> : ''}
              </button>
            )}
            <button
              className="nav-collapse quiet"
              aria-pressed={collapsed}
              aria-label={collapsed ? 'Expand the side bar' : 'Collapse the side bar'}
              title={collapsed ? 'Expand the side bar' : 'Collapse the side bar'}
              onClick={() => setPrefs({ railCollapsed: !collapsed })}
            >
              <Icon name="rail" />
            </button>
          </div>
        </nav>
      )}
      <div className="content" id="content" tabIndex={-1} ref={content}>
        {!stage && <ContextBar route={route} onCommands={onCommands} onActivity={onActivity} onHelp={onHelp} onRequests={onRequests} waiting={waitingRequests} palette={prefs.palette} />}
        {banner}
        {children}
      </div>
      {withPlayer && song && <MiniPlayer player={player} now={now} song={song} hasNext={hasNext ?? true} onRequests={onRequests} waiting={waitingRequests} />}
      {moreOpen && (
        <Drawer title="More" onClose={() => setMoreOpen(false)}>
          <nav className="more-nav" aria-label="Workspace">
            <p className="eyebrow">Workspace</p>
            <p className="hint">{aboutOf('workspace')}.</p>
            <ul>
              {workspaceTabs().map((item) => (
                <li key={item.tab}>
                  <PageLink to={item.path} aria-current={route.page === 'workshop' && route.tab === item.tab ? 'page' : undefined} onClick={() => setMoreOpen(false)}>{item.label}</PageLink>
                </li>
              ))}
            </ul>
          </nav>
        </Drawer>
      )}
      <Toaster />
      <LiveRegion />
    </div>
  );
}
