// The wire shapes of the business routes (ADR-0442, BZ-1), exactly as the server sends them.
// `types.ts` holds the richer view models the business screens read (ADR-0453); this file is the
// raw contract `api.ts` speaks, so the two can't drift silently: a screen maps from these.

/** A workspace this person can switch to. Every person has exactly one `personal` one. */
export type Workspace = {
  id: string;
  name: string;
  kind: 'personal' | 'team' | 'business';
  role: string;
  /** Epoch seconds a pilot organisation's pilot ends, or null when it is not a pilot. */
  pilot_until: number | null;
};

export type OrgRecord = {
  id: string;
  /** The organisation's workspace id, sent as X-Workspace-ID. Equal to `id` when the server
   * models the organisation as the workspace itself. */
  workspace_id?: string;
  name: string;
  legal_name?: string | null;
  country?: string | null;
  role?: string;
  pilot_until?: number | null;
  created_at?: number;
};

export type VenueStatus = 'active' | 'paused' | 'archived';

export type VenueAddress = { line1?: string; line2?: string; city?: string; postcode?: string; region?: string; [field: string]: string | undefined };

export type VenueRecord = {
  id: string;
  name: string;
  timezone: string;
  country: string;
  address?: VenueAddress | string | null;
  status: VenueStatus;
  created_at?: number;
  archived_at?: number | null;
};

export type NewVenue = { name: string; timezone: string; country: string; address?: VenueAddress | string };
export type VenueChange = { name?: string; status?: 'active' | 'paused'; timezone?: string };

export type ZoneStatus = 'active' | 'paused' | 'archived';

export type ZoneRecord = {
  id: string;
  venue_id: string;
  name: string;
  status: ZoneStatus;
  home_device_id?: string | null;
  standby_device_id?: string | null;
  created_at?: number;
  /** Epoch seconds an archive asked for "at closing" takes effect. */
  archive_at?: number | null;
};

export type ZoneChange = { name?: string; status?: 'active' | 'paused' };
export type ZoneArchive = { when: 'now' | 'closing'; closing_at?: number };

export type Crate = {
  id: string;
  name: string;
  /** null for an organisation-wide crate ("Brand core"). */
  venue_id: string | null;
  song_ids?: string[];
  song_count?: number;
  created_by?: string | null;
  created_at?: number;
};

/** One place a crate is used: a schedule block, a zone default or a content rule. */
export type CrateUse = { kind?: string; id?: string; label?: string; venue_id?: string | null; zone_id?: string | null; [field: string]: unknown };

/** The 409 body of a refused crate delete. */
export type CrateInUseBody = { uses: CrateUse[] };
