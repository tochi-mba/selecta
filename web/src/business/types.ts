// The shapes the business pages read (ADR-0442 to ADR-0453). The server packages BZ-1 to BZ-5
// own the real answers; until their routes land, `client.ts` returns the same shapes from typed
// stubs, so these types are the contract both sides build against.

export type Role = 'owner' | 'admin' | 'venue_manager' | 'staff' | 'viewer';

/** A workspace this person can switch to (ADR-0453 D9). Personal has no org fields. */
export type WorkspaceSummary = {
  id: string;
  kind: 'personal' | 'business';
  name: string;
  role: Role | 'owner';
  /** Business only: the light marks the switcher may show (no detail, D9 S7 matrix). */
  marks?: { silent_zones?: number; needs_you?: boolean; read_only?: boolean; pilot?: boolean };
};

export type Pilot = {
  status: 'active' | 'ending' | 'ended' | 'converted';
  /** Epoch seconds. */
  ends_at: number;
  allowance: { venues: number; zones: number };
};

export type BillingState = {
  /** `ok`, a failed payment inside the 14-day grace, or grace ended (read-only management). */
  status: 'ok' | 'grace' | 'grace_ended';
  /** Epoch seconds when grace ends (and playback stops at that venue's next close). */
  grace_ends_at?: number | null;
  currency: 'GBP' | 'USD' | 'EUR';
  plan: 'trial' | 'business' | 'business_annual' | 'enterprise' | 'pilot';
  trial_ends_at?: number | null;
  payments_available?: boolean;
  lines?: { item: 'venue' | 'zone' | 'seat'; quantity: number; unit_amount: number; interval: 'month' | 'year' }[];
  invoices?: { id: string; number: string; po_number?: string | null; amount: number; status: 'paid' | 'open' | 'failed'; issued_at: number; url?: string | null }[];
  invoicing?: 'consolidated' | 'per_venue';
  storage?: { used_bytes: number; limit_bytes: number };
};

export type Seats = { included: number; paid: number; held: number };

export type Org = {
  id: string;
  /** The workspace id, sent as X-Workspace-ID. */
  workspace_id: string;
  name: string;
  country: string;
  role: Role;
  /** Venue ids this person is scoped to; null means every venue (owner, admin, viewer). */
  venue_scope: string[] | null;
  pilot?: Pilot | null;
  billing: BillingState;
  seats: Seats;
  features: Record<string, boolean>;
  /** Plan-locked features name the plan that unlocks them, as Account.feature_locks. */
  feature_locks: Record<string, string>;
  setup?: SetupProgress | null;
};

export type SetupStepId = 'business' | 'venue' | 'hours' | 'zones' | 'licence' | 'music' | 'pair' | 'service';
export type SetupProgress = {
  venue_id?: string | null;
  done: SetupStepId[];
  skipped: SetupStepId[];
  current: SetupStepId;
  /** Unsaved-but-typed answers kept by the server so a refresh resumes mid-step. */
  draft?: Record<string, unknown>;
};

/** Minutes after midnight, venue time. `close` may exceed 1440 for overnight hours. */
export type OpeningSpan = { open: number; close: number };
export type WeekHours = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', OpeningSpan[]>;
export type Holiday = { date: string; closed: boolean; spans?: OpeningSpan[]; label?: string };

export type Licence = {
  kind: 'themusiclicence' | 'other';
  other_name?: string | null;
  number: string;
  /** ISO date (venue local). */
  expires_on: string;
  attested_at?: number | null;
};

export type Venue = {
  id: string;
  name: string;
  address: string;
  region?: string | null;
  tags?: string[];
  time_zone: string;
  phone?: string | null;
  hours?: WeekHours | null;
  holidays?: Holiday[];
  licence?: Licence | null;
  /** Is the venue inside opening hours now (server decides, venue time). */
  open_now: boolean;
  next_open_at?: number | null;
  next_close_at?: number | null;
  stay_open_late?: { allowance_minutes: number; until?: number | null };
  zones: Zone[];
  /** When health for this venue was last heard (epoch seconds). */
  health_at?: number | null;
};

export type ZonePlayState =
  | 'playing' | 'paused_by_staff' | 'closed' | 'quiet_hours' | 'playing_saved'
  | 'silent' | 'not_paired' | 'not_reporting' | 'plan_paused';

export type Song = { id: string; title: string; artist: string; explicit?: boolean };

export type Zone = {
  id: string;
  venue_id: string;
  name: string;
  state: ZonePlayState;
  /** Epoch seconds the current state began (silent since, paused since). */
  state_since?: number | null;
  paused_by?: string | null;
  now?: Song | null;
  next?: Song | null;
  /** 0..1 position in the current song. */
  progress?: number | null;
  volume?: number;
  volume_cap?: number;
  requests_waiting?: number;
  /** Last thing the speaker reported, for silent alerts. */
  last_report?: string | null;
  /** Paid zones beyond the plan are paused at close (plan locked). */
  paid: boolean;
  speaker_device_id?: string | null;
};

export type Device = {
  id: string;
  name: string;
  kind: 'kiosk' | 'tablet' | 'phone' | 'computer';
  zone_id?: string | null;
  online: boolean;
  last_seen_at?: number | null;
  saved_hours_ahead?: number | null;
  version?: string | null;
  network?: string | null;
};

export type Daypart = { id: string; name: string; start: number; end: number; energy: 'calm' | 'steady' | 'lifted' | 'peak'; crate_ids?: string[] };
export type ZoneSchedule = { zone_id: string; version: number; updated_by?: string | null; updated_at?: number | null; dayparts: Daypart[] };

export type GuestRequest = { id: string; zone_id: string; title: string; artist: string; nickname: string; waited_seconds: number; votes: number };

export type ContentRules = {
  explicit: 'allow' | 'block' | 'block_daytime';
  blocklist: { kind: 'song' | 'artist'; id: string; label: string }[];
  allowed_crates: { zone_id: string; daypart_id?: string | null; crate_ids: string[] }[];
  brand: { bpm_min?: number | null; bpm_max?: number | null; energy_max?: number | null };
  volume_caps: Record<string, number>;
  quiet_hours: { zone_id: string; start: number; end: number; cap: number }[];
};

export type Member = { id: string; name: string; email: string; role: Role; venue_ids: string[] | null; pin_set?: boolean };

export type PlayLogExportJob = { id: string; status: 'queued' | 'working' | 'ready' | 'failed'; done_venues: number; total_venues: number; url?: string | null; expires_at?: number | null; created_at: number; range: { from: string; to: string } };

export type Health = {
  /** Server said live updates are paused (events.ts fallback). */
  stream: 'live' | 'polling' | 'connecting';
  /** Command round trip in ms, measured by the client. */
  command_ms?: number | null;
  payments_down?: boolean;
  renders_slow?: boolean;
  commands_slow?: boolean;
};

export type ActivityEntry = { id: string; at: number; venue_id: string; zone_id?: string | null; words: string };

export type Overview = { org: Org; venues: Venue[]; devices?: Device[]; activity?: ActivityEntry[] };
