// Typed calls to the business routes (ADR-0442 to ADR-0452). Every page goes through these
// functions, never through raw paths. Each path in ROUTES is a route the server registers;
// `tests/test_business_client_routes.py` reads this file and api.ts and fails when one is not,
// so the two cannot drift again. Where the server's wire shape differs from the page's view
// model, clientAdapters.ts reshapes it. Each call names the organisation's workspace
// (X-Workspace-ID) so personal and business data never mix (ADR-0442); the organisation id is
// its workspace id.

import type { Api } from '../cloud/api';
import {
  applyParts, blocklistDiff, exceptionBody, hoursBody, membersOf, programmeBody, rulesBody, rulesOf, scheduleOf,
  type BlockEntry, type PeopleAnswer, type ProgrammeAnswer, type VenueRulesAnswer,
} from './clientAdapters';
import { TEMPLATES } from './forms/DaypartBar';
import type {
  ZoneAlert,
  BillingSummary, CheckoutAnswer, TermsAccess, VenueTransfer, CheckoutRequest, ContentRules, CostPreview, Daypart, Device, GuestRequest, Holiday, Licence, Member, Org, Overview,
  Role, SetupProgress, Venue, WeekHours, WorkspaceSummary, Zone, ZoneSchedule,
} from './types';

export const ROUTES = {
  workspaces: '/workspaces',
  createOrg: '/business/orgs',
  org: (org: string) => `/business/orgs/${enc(org)}`,
  overview: (org: string) => `/business/orgs/${enc(org)}/overview`,
  setup: (org: string) => `/business/orgs/${enc(org)}/setup`,
  venues: '/business/venues',
  venue: (venue: string) => `/business/venues/${enc(venue)}`,
  hours: (venue: string) => `/business/venues/${enc(venue)}/hours`,
  hourExceptions: (venue: string) => `/business/venues/${enc(venue)}/hour-exceptions`,
  zones: '/business/zones',
  zonesOf: (venue: string) => `/business/zones?venue_id=${enc(venue)}`,
  zone: (zone: string) => `/business/zones/${enc(zone)}`,
  licence: (venue: string) => `/business/venues/${enc(venue)}/licence`,
  rules: (venue: string) => `/business/venues/${enc(venue)}/content/rules`,
  blocklist: '/business/content/blocklist',
  blocklistEntry: (entry: string) => `/business/content/blocklist/${enc(entry)}`,
  stayLate: (venue: string) => `/business/venues/${enc(venue)}/stay-open-late`,
  unpair: (device: string) => `/devices/${enc(device)}/kiosk`,
  pair: '/kiosk/pair',
  kiosks: (venue?: string) => `/business/kiosks${venue ? `?venue_id=${enc(venue)}` : ''}`,
  zoneAlerts: (venue?: string) => `/business/zone-alerts${venue ? `?venue_id=${enc(venue)}` : ''}`,
  zoneAlertAck: (id: string) => `/business/zone-alerts/${enc(id)}/acknowledge`,
  schedule: (zone: string) => `/business/zones/${enc(zone)}/programme`,
  scheduleApply: '/business/schedules/apply',
  commands: (zone: string) => `/business/zones/${enc(zone)}/commands`,
  requests: (zone: string) => `/zones/${enc(zone)}/requests`,
  request: (zone: string, id: string, verdict: 'approve' | 'pass') => `/zones/${enc(zone)}/requests/${enc(id)}/${verdict}`,
  people: '/business/people',
  person: (user: string) => `/business/people/${enc(user)}`,
  invitations: '/business/invitations',
  revokeInvitation: (id: string) => `/business/invitations/${enc(id)}/revoke`,
  acceptInvitation: '/business/invitations/accept',
  playLogRetention: '/business/play-log/retention',
  isrcCoverage: (venue: string) => `/business/venues/${enc(venue)}/isrc-coverage`,
  terms: '/business/terms',
  licenceExtend: (venue: string) => `/business/venues/${enc(venue)}/licence/extend`,
  playLogExport: (venue: string, from: string, to: string) => `/business/play-log/export?venue_id=${enc(venue)}&from=${enc(from)}&to=${enc(to)}`,
  pinCheck: (venue: string) => `/business/venues/${enc(venue)}/pin`,
  librarySongs: '/business/library/songs',
  explicitBulk: '/business/library/explicit',
  billing: '/business/billing',
  billingPreview: '/business/billing/preview',
  billingPoNumber: '/business/billing/po-number',
  billingCostCentre: (venue: string) => `/business/billing/venues/${enc(venue)}/cost-centre`,
  billingCollection: '/business/billing/collection-method',
  billingBreakdown: '/business/billing/cost-breakdown',
  billingCheckout: '/business/billing/checkout',
  billingCheckoutComplete: '/business/billing/checkout/complete',
  billingDowngrade: '/business/billing/downgrade',
  billingResume: (venue: string) => `/business/billing/venues/${enc(venue)}/resume`,
  billingTransfers: '/business/billing/transfers',
  billingTransfer: (id: string, action: 'accept' | 'cancel') => `/business/billing/transfers/${enc(id)}/${action}`,
} as const;

function enc(value: string) { return encodeURIComponent(value); }
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export type ZoneCommand =
  | { kind: 'skip' }
  | { kind: 'steer'; word: 'bigger' | 'calmer' | 'something_else' }
  | { kind: 'undo'; command_id: string }
  | { kind: 'pause' } | { kind: 'resume' }
  | { kind: 'volume'; level: number }
  | { kind: 'test' };

export type ApplyPreview = { venues: number; open_now: number; conflicts: { venue_id: string; zone_id: string; updated_by: string; updated_at: number; theirs: Daypart[]; ours: Daypart[] }[] };

/** A pending invitation as the People page lists it. No email is sent: the accept link is
 * shown to the inviter to pass on. */
export type Invitation = { id: string; email: string; role: Role; venue_ids: string[] | null; created_at: number; expires_at: number };
export type People = { members: Member[]; invitations: Invitation[]; seats: PeopleAnswer['seats'] };

/** A page's ZoneCommand as one entry for the zone command route (offline.Command). */
export function commandBody(command: ZoneCommand, id: string, nowSeconds = Date.now() / 1000) {
  const base = { id, issued_at: nowSeconds, origin: 'staff' };
  switch (command.kind) {
    case 'resume': return { ...base, kind: 'play', payload: {} };
    case 'steer': return { ...base, kind: 'steer', payload: { word: command.word } };
    case 'volume': return { ...base, kind: 'volume', payload: { level: command.level } };
    case 'undo': return { ...base, kind: 'undo', payload: { command_id: command.command_id } };
    default: return { ...base, kind: command.kind, payload: {} };
  }
}

function templateParts(template?: string, dayparts?: Daypart[]): Daypart[] {
  if (dayparts?.length) return dayparts;
  return TEMPLATES.find((item) => item.id === template)?.dayparts ?? [];
}

/** The business client for one organisation workspace. */
export function businessClient(api: Api, workspaceId?: string) {
  const call = <T,>(path: string, init?: RequestInit) => api<T>(path, init, workspaceId);
  const inOrg = <T,>(org: string, path: string, init?: RequestInit) => api<T>(path, init, workspaceId ?? org);
  const blocklist = async () => (await call<{ entries: BlockEntry[] }>(ROUTES.blocklist)).entries ?? [];
  return {
    workspaces: async (): Promise<WorkspaceSummary[]> => {
      const answer = await api<{ workspaces?: { id: string; name: string; kind: string; role: Role; pilot_until: number | null }[] }>(ROUTES.workspaces);
      return (answer?.workspaces ?? []).map((item) => ({ id: item.id, name: item.name, kind: item.kind === 'business' ? 'business' : 'personal', role: item.role, marks: { pilot: item.pilot_until != null } }));
    },
    startTrial: (body: { name: string }) => api<{ org: Org }>(ROUTES.createOrg, json('POST', { name: body.name })),
    org: async (org: string) => (await inOrg<Overview>(org, ROUTES.overview(org))).org,
    overview: (org: string) => inOrg<Overview>(org, ROUTES.overview(org)),
    saveSetup: (org: string, progress: Partial<SetupProgress>) => inOrg<SetupProgress>(org, ROUTES.setup(org), json('PUT', progress)),
    saveBusinessDetails: (org: string, body: { name: string; country: string; billing_email: string; vat_number?: string; po_number?: string }) => inOrg<Org>(org, ROUTES.org(org), json('PATCH', body)),
    createVenue: async (_org: string, body: Pick<Venue, 'name' | 'address' | 'time_zone' | 'phone'> & { country?: string }) => {
      const answer = await call<{ venue: Venue }>(ROUTES.venues, json('POST', {
        name: body.name, timezone: body.time_zone, country: (body.country ?? 'GB').toUpperCase(), address: body.address ? { line1: body.address } : undefined,
      }));
      return answer.venue;
    },
    updateVenue: (_org: string, venue: string, body: { name?: string; time_zone?: string }) => call<{ venue: unknown }>(ROUTES.venue(venue), json('PATCH', { name: body.name, timezone: body.time_zone })),
    saveHours: async (_org: string, venue: string, hours: WeekHours, holidays: Holiday[]) => {
      await call(ROUTES.hours(venue), json('PUT', hoursBody(hours)));
      for (const holiday of holidays) await call(ROUTES.hourExceptions(venue), json('POST', exceptionBody(holiday)));
      return null;
    },
    addZone: async (_org: string, venue: string, name: string) => (await call<{ zone: Zone }>(ROUTES.zones, json('POST', { venue_id: venue, name }))).zone,
    renameZone: async (_org: string, _venue: string, zone: string, name: string) => (await call<{ zone: Zone }>(ROUTES.zone(zone), json('PATCH', { name }))).zone,
    saveLicence: (_org: string, venue: string, licence: Licence & { rights_confirmed: true }) => call<{ venue_id: string }>(ROUTES.licence(venue), json('PUT', {
      kind: licence.kind, other_name: licence.other_name ?? null, number: licence.number, expires_on: licence.expires_on, rights_confirmed: licence.rights_confirmed,
    })),
    rules: async (_org: string, venue: string): Promise<ContentRules> => {
      const [answer, entries] = await Promise.all([call<VenueRulesAnswer>(ROUTES.rules(venue)), blocklist()]);
      return rulesOf(answer, entries, venue);
    },
    saveRules: async (_org: string, venue: string, rules: ContentRules): Promise<ContentRules> => {
      const [zones, current] = await Promise.all([call<{ zones: { id: string }[] }>(ROUTES.zonesOf(venue)), call<VenueRulesAnswer>(ROUTES.rules(venue))]);
      await call(ROUTES.rules(venue), json('PUT', rulesBody(rules, (zones.zones ?? []).map((zone) => zone.id), current)));
      const change = blocklistDiff(rules.blocklist, await blocklist(), venue);
      for (const entry of change.add) await call(ROUTES.blocklist, json('POST', entry));
      for (const id of change.remove) await call(ROUTES.blocklistEntry(id), json('DELETE'));
      return rules;
    },
    stayOpenLate: (_org: string, venue: string, minutes: number) => call<unknown>(ROUTES.stayLate(venue), json('POST', { minutes })),
    unpair: (device: string) => call<null>(ROUTES.unpair(device), json('DELETE')),
    pair: (body: { code: string; zone_id: string; name: string; replace_device_id?: string }) => call<Device>(ROUTES.pair, json('POST', body)),
    /** The kiosk players this person may see, with their latest health (ADR-0445). */
    kiosks: async (venue?: string) => (await call<{ kiosks: Device[] }>(ROUTES.kiosks(venue))).kiosks,
    /** Open player alerts (ADR-0445 BZ-0445-10): silent, offline, needs a tap, needs pairing, refused copy. */
    zoneAlerts: async (venue?: string) => (await call<{ alerts: ZoneAlert[] }>(ROUTES.zoneAlerts(venue))).alerts,
    acknowledgeZoneAlert: (id: string) => call<{ id: string }>(ROUTES.zoneAlertAck(id), json('POST')),
    schedule: async (zone: string) => scheduleOf(zone, await call<ProgrammeAnswer>(ROUTES.schedule(zone))),
    saveSchedule: async (zone: string, schedule: ZoneSchedule) => scheduleOf(zone, await call<ProgrammeAnswer>(ROUTES.schedule(zone), json('PUT', programmeBody(schedule.dayparts)))),
    previewApply: (_org: string, body: { venue_ids: string[]; template?: string; dayparts?: Daypart[] }) =>
      call<ApplyPreview>(ROUTES.scheduleApply, json('POST', { venue_ids: body.venue_ids, dayparts: applyParts(templateParts(body.template, body.dayparts)), preview: true })),
    apply: (_org: string, body: { venue_ids: string[]; template?: string; dayparts?: Daypart[]; versions: Record<string, number> }) =>
      call<{ applied: number }>(ROUTES.scheduleApply, json('POST', { venue_ids: body.venue_ids, dayparts: applyParts(templateParts(body.template, body.dayparts)), versions: body.versions })),
    command: async (zone: string, command: ZoneCommand, idempotency: string = newKey()) => {
      const answer = await call<{ applied?: string[]; duplicates?: string[] }>(ROUTES.commands(zone), json('POST', { commands: [commandBody(command, idempotency)] }));
      return { id: idempotency, accepted: (answer?.applied ?? []).includes(idempotency) || (answer?.duplicates ?? []).includes(idempotency) };
    },
    requests: (zone: string) => call<GuestRequest[]>(ROUTES.requests(zone)),
    decide: (zone: string, id: string, verdict: 'approve' | 'pass') => call<null>(ROUTES.request(zone, id, verdict), json('POST')),
    people: async (): Promise<People> => {
      const answer = await call<PeopleAnswer>(ROUTES.people);
      return { members: membersOf(answer), invitations: answer.invitations ?? [], seats: answer.seats };
    },
    members: async (_org: string) => membersOf(await call<PeopleAnswer>(ROUTES.people)),
    invite: (_org: string, body: { email: string; role: Role; venue_ids: string[] | null }) =>
      call<{ invitation: Invitation; accept_url: string; emailed: false }>(ROUTES.invitations, json('POST', body)),
    revokeInvitation: (id: string) => call<{ revoked: string }>(ROUTES.revokeInvitation(id), json('POST')),
    acceptInvitation: (token: string, name?: string) => api<{ org_id: string; workspace_id: string }>(ROUTES.acceptInvitation, json('POST', { token, name })),
    removeMember: (_org: string, id: string) => call<{ removed: string }>(ROUTES.person(id), json('DELETE')),
    isrcCoverage: (venue: string) => call<{ tracks: number; with_isrc: number; share: number }>(ROUTES.isrcCoverage(venue)),
    playLogRetention: () => call<{ days: number; default_days: number }>(ROUTES.playLogRetention),
    setPlayLogRetention: (days: number) => call<{ days: number }>(ROUTES.playLogRetention, json('PUT', { days })),
    termsAccess: () => call<TermsAccess>(ROUTES.terms),
    acceptTerms: () => call<TermsAccess>(`${ROUTES.terms}/accept`, json('POST')),
    extendLicenceGrace: (venue: string, reason: string) => call<{ extended_until: number }>(ROUTES.licenceExtend(venue), json('POST', { reason })),
    exportPlayLog: (venue: string, from: string, to: string) => call<{ filename: string; csv: string }>(ROUTES.playLogExport(venue, from, to)),
    checkPin: (_org: string, venue: string, pin: string) => call<{ ok: boolean; member_name?: string; role?: Role }>(ROUTES.pinCheck(venue), json('POST', { pin })),
    librarySongs: async (_org: string) => (await call<{ songs: LibrarySong[] }>(ROUTES.librarySongs)).songs ?? [],
    markExplicit: (_org: string, body: { song_ids: string[]; explicit: 'explicit' | 'clean' }) => call<{ updated: number }>(ROUTES.explicitBulk, json('POST', body)),
    billingSummary: () => call<BillingSummary>(ROUTES.billing),
    previewCost: (add: { venues: number; zones: number; seats: number }) => call<CostPreview>(ROUTES.billingPreview, json('POST', add)),
    savePoNumber: (poNumber: string) => call<{ po_number: string | null }>(ROUTES.billingPoNumber, json('PUT', { po_number: poNumber })),
    saveCostCentre: (venue: string, costCentre: string) => call<{ venue_id: string; cost_centre: string | null }>(ROUTES.billingCostCentre(venue), json('PUT', { cost_centre: costCentre })),
    saveCollectionMethod: (method: 'charge_automatically' | 'send_invoice') => call<{ collection_method: string; net_days: number | null }>(ROUTES.billingCollection, json('PUT', { method })),
    costBreakdown: () => call<{ filename: string; csv: string }>(ROUTES.billingBreakdown),
    startCheckout: (body: CheckoutRequest) => call<CheckoutAnswer>(ROUTES.billingCheckout, json('POST', body)),
    downgrade: (keepVenueIds: string[], paidZones: Record<string, number> = {}) => call<{ pausing: { venue_id: string; pause_at: number }[] }>(ROUTES.billingDowngrade, json('POST', { keep_venue_ids: keepVenueIds, paid_zones: paidZones })),
    resumeVenue: (venue: string) => call<{ venue_id: string; state: string }>(ROUTES.billingResume(venue), json('POST')),
    transfers: () => call<{ organisation_id: string; transfers: VenueTransfer[] }>(ROUTES.billingTransfers),
    proposeTransfer: (venue: string, target: string) => call<{ transfer: { id: string; state: string } }>(ROUTES.billingTransfers, json('POST', { venue_id: venue, target_organisation_id: target })),
    answerTransfer: (id: string, action: 'accept' | 'cancel') => call<unknown>(ROUTES.billingTransfer(id, action), json('POST')),
    completeCheckout: (sessionId: string) => call<{ subscribed: boolean; status: string | null }>(ROUTES.billingCheckoutComplete, json('POST', { session_id: sessionId })),
  };
}

export type BusinessClient = ReturnType<typeof businessClient>;

/** A song in the organisation library as the explicit editor and blocklist read it (ADR-0450).
 * Title and artist come from the song's catalogue entry; an upload with none has an empty artist. */
export type LibrarySong = { id: string; title: string; artist: string; explicit: 'explicit' | 'clean' | 'unknown' };
