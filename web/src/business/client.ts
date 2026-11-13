// Typed calls to the business routes (ADR-0442 to ADR-0452). Every page goes through these
// functions, never through raw paths, so when the BZ-1 to BZ-5 routes land with different paths
// only ROUTES changes. Each call names the organisation's workspace (X-Workspace-ID) so personal
// and business data never mix (ADR-0442).
//
// Until those routes exist, `fixtures.ts` provides `demoApi`, a stub with the same answers, used
// by the tests and the e2e harness.

import type { Api } from '../cloud/api';
import type {
  ContentRules, Daypart, Device, GuestRequest, Holiday, Licence, Member, Org, Overview, PlayLogExportJob,
  Role, SetupProgress, Venue, WeekHours, WorkspaceSummary, Zone, ZoneSchedule,
} from './types';

export const ROUTES = {
  workspaces: '/business/workspaces',
  pilotInterest: '/business/pilot-interest',
  start: '/business/start',
  org: (org: string) => `/orgs/${enc(org)}`,
  overview: (org: string) => `/orgs/${enc(org)}/overview`,
  setup: (org: string) => `/orgs/${enc(org)}/setup`,
  venues: (org: string) => `/orgs/${enc(org)}/venues`,
  venue: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}`,
  hours: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/hours`,
  zones: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/zones`,
  licence: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/licence`,
  rules: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/rules`,
  stayLate: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/stay-open-late`,
  copyPersonal: (org: string) => `/orgs/${enc(org)}/library/copy-from-personal`,
  devices: (org: string) => `/orgs/${enc(org)}/devices`,
  unpair: (device: string) => `/devices/${enc(device)}/kiosk`,
  pair: '/kiosk/pair',
  schedule: (zone: string) => `/zones/${enc(zone)}/schedule`,
  scheduleApply: (org: string) => `/orgs/${enc(org)}/schedules/apply`,
  commands: (zone: string) => `/zones/${enc(zone)}/playback/commands`,
  requests: (zone: string) => `/zones/${enc(zone)}/requests`,
  request: (zone: string, id: string, verdict: 'approve' | 'pass') => `/zones/${enc(zone)}/requests/${enc(id)}/${verdict}`,
  members: (org: string) => `/orgs/${enc(org)}/members`,
  member: (org: string, id: string) => `/orgs/${enc(org)}/members/${enc(id)}`,
  exports: (org: string) => `/orgs/${enc(org)}/play-log-exports`,
  pinCheck: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/pin`,
  adminPilots: '/admin/business/pilots',
  adminPilot: (id: string, action: 'extend' | 'allowance' | 'convert' | 'end') => `/admin/business/pilots/${enc(id)}/${action}`,
  requestSettings: (org: string, venue: string) => `/orgs/${enc(org)}/venues/${enc(venue)}/request-settings`,
  librarySongs: (org: string) => `/orgs/${enc(org)}/library/songs`,
  explicitBulk: (org: string) => `/orgs/${enc(org)}/library/explicit`,
} as const;

function enc(value: string) { return encodeURIComponent(value); }
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export type ZoneCommand =
  | { kind: 'skip' }
  | { kind: 'steer'; word: 'bigger' | 'calmer' | 'something_else' }
  | { kind: 'undo'; command_id: string }
  | { kind: 'pause' } | { kind: 'resume' }
  | { kind: 'volume'; level: number }
  | { kind: 'test' }
  | { kind: 'play_here'; device_id: string };

export type ApplyPreview = { venues: number; open_now: number; conflicts: { venue_id: string; zone_id: string; updated_by: string; updated_at: number; theirs: Daypart[]; ours: Daypart[] }[] };

export type PilotRow = { id: string; org_name: string; owner_email: string; venues_used: number; zones_used: number; allowance: { venues: number; zones: number }; starts_at: number; ends_at: number; status: 'active' | 'ending' | 'ended' | 'converted'; last_activity_at?: number | null; note?: string | null };

/** The business client for one organisation workspace. */
export function businessClient(api: Api, workspaceId?: string) {
  const call = <T,>(path: string, init?: RequestInit) => api<T>(path, init, workspaceId);
  return {
    workspaces: () => api<WorkspaceSummary[]>(ROUTES.workspaces),
    pilotInterest: (body: { name: string; email: string; venue: string; venues: number; message?: string }) => api<{ ok: true }>(ROUTES.pilotInterest, json('POST', body)),
    startTrial: (body: { name: string; country: string; billing_email: string; vat_number?: string; po_number?: string }) => api<{ org: Org; checkout_url?: string | null }>(ROUTES.start, json('POST', body)),
    org: (org: string) => call<Org>(ROUTES.org(org)),
    overview: (org: string) => call<Overview>(ROUTES.overview(org)),
    saveSetup: (org: string, progress: Partial<SetupProgress>) => call<SetupProgress>(ROUTES.setup(org), json('PUT', progress)),
    saveBusinessDetails: (org: string, body: { name: string; country: string; billing_email: string; vat_number?: string; po_number?: string }) => call<Org>(ROUTES.org(org), json('PATCH', body)),
    createVenue: (org: string, body: Pick<Venue, 'name' | 'address' | 'time_zone' | 'phone'>) => call<Venue>(ROUTES.venues(org), json('POST', body)),
    updateVenue: (org: string, venue: string, body: Partial<Pick<Venue, 'name' | 'address' | 'time_zone' | 'phone' | 'region' | 'tags'>>) => call<Venue>(ROUTES.venue(org, venue), json('PATCH', body)),
    venue: (org: string, venue: string) => call<Venue>(ROUTES.venue(org, venue)),
    saveHours: (org: string, venue: string, hours: WeekHours, holidays: Holiday[]) => call<Venue>(ROUTES.hours(org, venue), json('PUT', { hours, holidays })),
    addZone: (org: string, venue: string, name: string) => call<Zone>(ROUTES.zones(org, venue), json('POST', { name })),
    renameZone: (org: string, venue: string, zone: string, name: string) => call<Zone>(`${ROUTES.zones(org, venue)}/${enc(zone)}`, json('PATCH', { name })),
    saveLicence: (org: string, venue: string, licence: Licence & { rights_confirmed: true }) => call<Venue>(ROUTES.licence(org, venue), json('PUT', licence)),
    rules: (org: string, venue: string) => call<ContentRules>(ROUTES.rules(org, venue)),
    saveRules: (org: string, venue: string, rules: ContentRules) => call<ContentRules>(ROUTES.rules(org, venue), json('PUT', rules)),
    stayOpenLate: (org: string, venue: string, minutes: number) => call<Venue>(ROUTES.stayLate(org, venue), json('POST', { minutes })),
    copyFromPersonal: (org: string, body: { personal_workspace_id: string; crate_ids: string[]; song_ids: string[] }) => call<{ copied: number; job_id?: string }>(ROUTES.copyPersonal(org), json('POST', body)),
    devices: (org: string) => call<Device[]>(ROUTES.devices(org)),
    unpair: (device: string) => call<null>(ROUTES.unpair(device), json('DELETE')),
    pair: (body: { code: string; zone_id: string; name: string }) => call<Device>(ROUTES.pair, json('POST', body)),
    schedule: (zone: string) => call<ZoneSchedule>(ROUTES.schedule(zone)),
    saveSchedule: (zone: string, schedule: ZoneSchedule) => call<ZoneSchedule>(ROUTES.schedule(zone), json('PUT', schedule)),
    previewApply: (org: string, body: { venue_ids: string[]; template?: string; dayparts?: Daypart[] }) => call<ApplyPreview>(ROUTES.scheduleApply(org), json('POST', { ...body, preview: true })),
    apply: (org: string, body: { venue_ids: string[]; template?: string; dayparts?: Daypart[]; versions: Record<string, number> }) => call<{ applied: number }>(ROUTES.scheduleApply(org), json('POST', body)),
    command: (zone: string, command: ZoneCommand, idempotency: string) => call<{ id: string; accepted: boolean }>(ROUTES.commands(zone), { ...json('POST', command), headers: { 'Idempotency-Key': idempotency } }),
    requests: (zone: string) => call<GuestRequest[]>(ROUTES.requests(zone)),
    decide: (zone: string, id: string, verdict: 'approve' | 'pass') => call<null>(ROUTES.request(zone, id, verdict), json('POST')),
    members: (org: string) => call<Member[]>(ROUTES.members(org)),
    invite: (org: string, body: { email: string; role: Role; venue_ids: string[] | null }) => call<Member>(ROUTES.members(org), json('POST', body)),
    removeMember: (org: string, id: string) => call<null>(ROUTES.member(org, id), json('DELETE')),
    exports: (org: string) => call<PlayLogExportJob[]>(ROUTES.exports(org)),
    startExport: (org: string, body: { venue_ids: string[] | null; from: string; to: string; format: 'csv' }) => call<PlayLogExportJob>(ROUTES.exports(org), json('POST', body)),
    checkPin: (org: string, venue: string, pin: string) => call<{ ok: boolean; member_name?: string; role?: Role }>(ROUTES.pinCheck(org, venue), json('POST', { pin })),
    pilots: () => api<PilotRow[]>(ROUTES.adminPilots),
    createPilot: (body: { org_name: string; owner_email: string; allowance: { venues: number; zones: number }; ends_at: number; note?: string; reason: string }) => api<PilotRow>(ROUTES.adminPilots, json('POST', body)),
    pilotAction: (id: string, action: 'extend' | 'allowance' | 'convert' | 'end', body: { reason: string; ends_at?: number; allowance?: { venues: number; zones: number } }) => api<PilotRow>(ROUTES.adminPilot(id, action), json('POST', body)),
    requestSettings: (org: string, venue: string) => call<RequestSettings | null>(ROUTES.requestSettings(org, venue)),
    saveRequestSettings: (org: string, venue: string, settings: RequestSettings) => call<RequestSettings>(ROUTES.requestSettings(org, venue), json('PUT', settings)),
    librarySongs: (org: string) => call<LibrarySong[] | null>(ROUTES.librarySongs(org)),
    markExplicit: (org: string, body: { song_ids: string[]; explicit: 'explicit' | 'clean' }) => call<{ updated: number } | null>(ROUTES.explicitBulk(org), json('POST', body)),
  };
}

export type BusinessClient = ReturnType<typeof businessClient>;

/** Rooms for Business settings for one venue (ADR-0451): request mode per zone, limits, guest page look. */
export type RequestMode = 'approve' | 'auto' | 'off';
export type RequestSettings = {
  modes: Record<string, RequestMode>;
  limits: { per_guest: number; per_guest_hour: number; cooldown_minutes: number; zone_pending: number; accepted_hour: number };
  branding: { welcome: string; accent?: string | null; logo_url?: string | null };
  /** Stable join codes per zone, for the print sheet. */
  codes?: Record<string, string>;
};

/** A song in the organisation library as the explicit editor and blocklist read it (ADR-0450). */
export type LibrarySong = { id: string; title: string; artist: string; explicit: 'explicit' | 'clean' | 'unknown' };
