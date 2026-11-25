import { useCallback, useEffect, useState } from 'react';
import { useWorkProfile } from '../business/feelBits';
import { setFlags } from '../flags';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { StaffDashboard } from './StaffDashboard';
import { emergencyStop, fetchDashboard, sendCommand, staffRuntimeFlags, type CommandKind, type DashboardState } from './staffApi';

/** How often the open dashboard reads the venue again, so a waiting change shows as done, health
 * stays true and a dropped connection recovers by itself. */
const REFRESH_MS = 5000;
const OFFLINE = 'Can’t reach SelectaDJ right now. This page keeps trying by itself.';

/** The browser's "Failed to fetch" in words staff can act on. */
function wordsOf(failure: unknown): string {
  return failure instanceof TypeError ? OFFLINE : (failure as Error).message;
}

/** URL host for the opt-in venue staff dashboard. The server feature gate controls
 * visibility: a default/off flag remains Not found, and no UI action bypasses the
 * session's server-side command permissions. */
export function VenueStaffRoot() {
  const match = /^\/venue\/staff\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  const session = match?.[1] ?? '';
  // This screen opens outside the Shell, straight from RuntimeApp, so it holds the calm profile
  // itself: a venue tablet is a work tool, and nothing on it answers the music (ADR-0477 plan 3.14).
  useWorkProfile();
  const [allowed, setAllowed] = useState(false);
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const flags = await staffRuntimeFlags();
        if (!active) return;
        if (flags['venue.staff_dashboard'] !== true) {
          setChecked(true);
          return;
        }
        setFlags(flags);
        setAllowed(true);
        const next = await fetchDashboard(session);
        if (active) { setState(next); setError(''); }
      } catch (failure) {
        if (active) setError(wordsOf(failure));
      } finally {
        if (active) setChecked(true);
      }
    };
    void load();
    return () => { active = false; };
  }, [session, attempt]);

  // Once the gate has said yes, keep the dashboard current; a good read clears an old problem.
  const refresh = useCallback(() => fetchDashboard(session).then((next) => { setState(next); setError(''); }, (failure) => {
    setError(wordsOf(failure));
    throw failure;
  }), [session]);
  useVisiblePoll(refresh, REFRESH_MS, allowed, { backoff: true });

  const command = (kind: CommandKind, params?: Record<string, unknown>) => {
    void sendCommand(session, kind, params).then(() => fetchDashboard(session)).then((next) => { setState(next); setError(''); })
      .catch((failure: Error) => setError(wordsOf(failure)));
  };
  const stop = () => {
    void emergencyStop(session).then(() => fetchDashboard(session)).then((next) => { setState(next); setError(''); })
      .catch((failure: Error) => setError(wordsOf(failure)));
  };

  if (!checked) return <main><h1>Loading staff dashboard</h1></main>;
  // a gate that could not be read is a connection problem, not a missing page
  if (!allowed && error) return <main><h1>Can’t open the staff dashboard</h1><p role="alert">{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></main>;
  if (!allowed) return <main><h1>Not found</h1></main>;
  if (!state) return <main><h1>Connecting to venue staff</h1>{error && <p role="alert">{error}</p>}</main>;
  return (
    <main className="staff-screen">
      <StaffDashboard state={state} onCommand={command} onStop={stop} />
      {error && <p role="alert" className="staff-error">{error}</p>}
    </main>
  );
}
