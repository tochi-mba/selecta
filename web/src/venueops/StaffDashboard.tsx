import { ReactNode, useEffect, useRef, useState } from 'react';
import { FlagId, useFlag } from '../flags';
import { CommandKind, DashboardState, STEERING, StaffCommand } from './staffApi';
import './staffDashboard.css';

/** ADR-0430: the one-glance staff dashboard for an Autopilot venue night. What is playing, what is
 * next, the plan in one line, health in words, typed steering, pending versus applied changes and
 * an always-visible emergency Stop. Expert controls stay one link away in every state.
 *
 * Gated by `venue.staff_dashboard` (src/selecta/flags/venueops.json). That area file isn't in
 * flags.ts's AREAS yet, so the id is cast through string, the same way business flags are. Not
 * mounted in the app yet: it takes its state as props so a host page can feed it. */

export const STAFF_DASHBOARD_FLAG = 'venue.staff_dashboard' as string as FlagId;

export type StaffDashboardProps = {
  /** null while loading */
  state: DashboardState | null;
  onCommand: (kind: CommandKind, params?: Record<string, unknown>) => void;
  onStop: () => void;
  genres?: string[];
  /** How an expert control link is drawn; a plain link by default. */
  link?: (path: string, label: string) => ReactNode;
};

const NAV_WORDS: Record<DashboardState['nav'], string> = {
  loading: 'Connecting',
  setting_up: 'Getting ready',
  live: 'Autopilot playing',
  paused: 'Paused',
  manual: 'Manual',
  offline: 'Offline',
  failed: 'Needs a person',
  stopped: 'Stopped',
};

function CommandRow({ command }: { command: StaffCommand }) {
  return (
    <li className={`staff-command is-${command.state}`} data-state={command.state}>
      <span className="staff-command-state">{command.state === 'pending' ? 'Waiting' : command.state === 'applied' ? 'Done' : command.state === 'superseded' ? 'Replaced' : 'Not done'}</span>
      <span>{command.words}</span>
    </li>
  );
}

export function StaffDashboard(props: StaffDashboardProps) {
  const on = useFlag(STAFF_DASHBOARD_FLAG);
  if (!on) return null;
  return <Dashboard {...props} />;
}

function Dashboard({ state, onCommand, onStop, genres = [], link }: StaffDashboardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The page arrives after async flag and session checks. Orient keyboard and screen reader
  // visitors at its title; the -1 target stays out of the ordinary Tab sequence.
  useEffect(() => { headingRef.current?.focus(); }, []);
  const [genre, setGenre] = useState(genres[0] ?? '');
  const nav = state?.nav ?? 'loading';
  const enabled = new Set(state?.enabled ?? []);
  const stopEnabled = state ? state.stop.enabled : true;
  const drawLink = link ?? ((path: string, label: string) => <a href={path}>{label}</a>);
  const send = (kind: CommandKind) => {
    if (kind === 'hold_genre') onCommand(kind, { genre });
    else onCommand(kind);
  };

  return (
    <section className="staff-dashboard" data-nav={nav} aria-labelledby="staff-dashboard-title" aria-busy={nav === 'loading'}>
      <header className="staff-top">
        <div className="staff-heading">
          <h1 id="staff-dashboard-title" ref={headingRef} tabIndex={-1}>Staff dashboard</h1>
          <p className="staff-nav" data-testid="staff-nav"><span className="staff-nav-dot" aria-hidden="true" />{NAV_WORDS[nav]}</p>
        </div>
        <button type="button" className="staff-stop" onClick={onStop} disabled={!stopEnabled}
          aria-describedby="staff-stop-help">
          {stopEnabled ? 'Stop' : 'Stopped'}
        </button>
        <p id="staff-stop-help" className="staff-visually-hidden">Emergency stop. Stops the music at once.</p>
      </header>

      <p className="staff-headline">{state?.headline ?? "Connecting to tonight's music."}</p>

      <div className="staff-glance">
        <article className="staff-card" aria-label="Now playing">
          <h2>Now</h2>
          {state?.now ? <p><strong>{state.now.title}</strong><span>{state.now.artist}</span></p> : <p>Nothing playing.</p>}
        </article>
        <article className="staff-card" aria-label="Next">
          <h2>Next</h2>
          {state?.next ? <p><strong>{state.next.title}</strong><span>{state.next.artist}</span></p> : <p>Not chosen yet.</p>}
        </article>
        <article className="staff-card" aria-label="Plan">
          <h2>Plan</h2>
          <p>{state?.horizon.words ?? 'Nothing planned yet.'}</p>
        </article>
        <article className={`staff-card staff-health is-${state?.health.level ?? 'ok'}`} aria-label="Health">
          <h2>Health</h2>
          <p>{state?.health.words ?? 'Checking.'}</p>
        </article>
      </div>

      <section className="staff-steer" aria-labelledby="staff-steer-title">
        <h2 id="staff-steer-title">Steer</h2>
        {genres.length > 0 && (
          <label className="staff-genre">
            <span>Genre to hold</span>
            <select value={genre} onChange={(event) => setGenre(event.target.value)}>
              {genres.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <div className="staff-buttons" role="group" aria-label="Steering commands">
          {STEERING.map(({ kind, label }) => (
            <button key={kind} type="button" disabled={!enabled.has(kind) || (kind === 'hold_genre' && !genre)}
              onClick={() => send(kind)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="staff-changes" aria-labelledby="staff-changes-title">
        <h2 id="staff-changes-title">Changes</h2>
        <p className="staff-live" role="status" aria-live="polite" aria-atomic="true" data-testid="staff-announcement">{state?.announcement ?? ''}</p>
        <h3>Waiting</h3>
        {state?.pending.length ? <ul data-testid="staff-pending">{state.pending.map((c) => <CommandRow key={c.id} command={c} />)}</ul> : <p>Nothing waiting.</p>}
        <h3>Recent</h3>
        {state?.applied.length ? <ul data-testid="staff-applied">{state.applied.map((c) => <CommandRow key={c.id} command={c} />)}</ul> : <p>No changes yet.</p>}
      </section>

      <nav className="staff-expert" aria-label="Expert controls">
        <h2>Expert controls</h2>
        <ul>
          {(state?.expert_controls ?? EXPERT_FALLBACK).map((control) => <li key={control.id}>{drawLink(control.path, control.label)}</li>)}
        </ul>
      </nav>
    </section>
  );
}

/** The same list as EXPERT_CONTROLS in staff_commands.py, shown while the state is loading. */
export const EXPERT_FALLBACK = [
  { id: 'listen', label: 'Listen and transport', path: '/listen' },
  { id: 'edit_mix', label: 'Edit the mix', path: '/mix/current/edit' },
  { id: 'mixes', label: 'Mixes', path: '/mixes' },
  { id: 'library', label: 'Library', path: '/library' },
  { id: 'discover', label: 'Discover', path: '/discover' },
  { id: 'lucy', label: 'Lucy', path: '/mixes/lucy' },
  { id: 'workshop', label: 'Workshop', path: '/workshop' },
];
