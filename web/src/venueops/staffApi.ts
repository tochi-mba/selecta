/** The staff dashboard's shape, as `GET /api/venue/staff/{session}/dashboard` returns it
 * (src/selecta/venueops/dashboard_state.py), and the calls that steer the night
 * (src/selecta/venueops/routes_staff.py). Those routes are not mounted yet. */

export type NavState = 'loading' | 'setting_up' | 'live' | 'paused' | 'manual' | 'offline' | 'failed' | 'stopped';
export type CommandKind =
  | 'more_energy' | 'less_energy' | 'hold_genre' | 'skip_next' | 'extend_current'
  | 'pause' | 'emergency_stop' | 'hand_to_manual';
export type CommandState = 'pending' | 'applied' | 'rejected' | 'superseded';

export type StaffCommand = {
  id: string;
  kind: CommandKind;
  label: string;
  params: Record<string, unknown>;
  state: CommandState;
  apply_at: 'now' | 'next_seam' | 'current_outro';
  seam_id: string | null;
  submitted_at: number;
  resolved_at: number | null;
  by: string;
  reason: string;
  superseded_by: string | null;
  words: string;
};

export type Track = { title: string; artist: string; seconds_left: number | null };

export type DashboardState = {
  nav: NavState;
  headline: string;
  now: Track | null;
  next: Track | null;
  horizon: { songs: number; minutes: number; words: string };
  health: { level: 'ok' | 'warning' | 'fault'; words: string };
  pending: StaffCommand[];
  applied: StaffCommand[];
  enabled: CommandKind[];
  stop: { visible: boolean; enabled: boolean };
  announcement: string;
  expert_controls: { id: string; label: string; path: string }[];
};

/** The steering buttons, in the order staff see them. Stop is separate and always on screen. */
export const STEERING: { kind: CommandKind; label: string }[] = [
  { kind: 'more_energy', label: 'More energy' },
  { kind: 'less_energy', label: 'Less energy' },
  { kind: 'hold_genre', label: 'Hold genre' },
  { kind: 'skip_next', label: 'Skip next' },
  { kind: 'extend_current', label: 'Extend current' },
  { kind: 'pause', label: 'Pause' },
  { kind: 'hand_to_manual', label: 'Hand to manual' },
];

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`The staff dashboard couldn't reach SelectaDJ (${response.status}).`);
  return (await response.json()) as T;
}

export async function fetchDashboard(session: string): Promise<DashboardState> {
  return json(await fetch(`/api/venue/staff/${encodeURIComponent(session)}/dashboard`));
}

export async function sendCommand(session: string, kind: CommandKind, params: Record<string, unknown> = {}): Promise<StaffCommand> {
  return json(await fetch(`/api/venue/staff/${encodeURIComponent(session)}/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, params }),
  }));
}

export async function emergencyStop(session: string): Promise<StaffCommand> {
  return json(await fetch(`/api/venue/staff/${encodeURIComponent(session)}/stop`, { method: 'POST' }));
}
