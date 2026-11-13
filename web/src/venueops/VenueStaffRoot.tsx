import { useEffect, useState } from 'react';
import { setFlags } from '../flags';
import { StaffDashboard } from './StaffDashboard';
import { emergencyStop, fetchDashboard, sendCommand, type CommandKind, type DashboardState } from './staffApi';

/** URL host for the opt-in venue staff dashboard. The server feature gate controls
 * visibility: a default/off flag remains Not found, and no UI action bypasses the
 * session's server-side command permissions. */
export function VenueStaffRoot() {
  const match = /^\/venue\/staff\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  const session = match?.[1] ?? '';
  const [allowed, setAllowed] = useState(false);
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const statusResponse = await fetch('/api/status');
        if (!statusResponse.ok) throw new Error('The venue service is unavailable.');
        const status = (await statusResponse.json()) as { flags?: Record<string, boolean> };
        if (!active) return;
        if (status.flags?.['venue.staff_dashboard'] !== true) {
          setChecked(true);
          return;
        }
        setFlags(status.flags);
        setAllowed(true);
        const next = await fetchDashboard(session);
        if (active) setState(next);
      } catch (failure) {
        if (active) setError((failure as Error).message);
      } finally {
        if (active) setChecked(true);
      }
    };
    void load();
    return () => { active = false; };
  }, [session]);

  const command = (kind: CommandKind, params?: Record<string, unknown>) => {
    void sendCommand(session, kind, params).then(() => fetchDashboard(session)).then(setState)
      .catch((failure: Error) => setError(failure.message));
  };
  const stop = () => {
    void emergencyStop(session).then(() => fetchDashboard(session)).then(setState)
      .catch((failure: Error) => setError(failure.message));
  };

  if (!checked) return <main><h1>Loading staff dashboard</h1></main>;
  if (!allowed) return <main><h1>Not found</h1></main>;
  return (
    <main className="staff-screen">
      <StaffDashboard state={state} onCommand={command} onStop={stop} />
      {error && <p role="alert" className="staff-error">{error}</p>}
    </main>
  );
}
