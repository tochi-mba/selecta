// The business routes, typed (ADR-0442, BZ-1). Every call goes through the site's own `Api`
// helper (CloudApp's `api`), which adds the signed-in token and the X-Workspace-ID header, so this
// file never builds headers itself. Bind it to the active workspace once with `businessApi`.

import type { Api } from '../cloud/api';
import type {
  Crate, CrateUse, NewVenue, OrgRecord, VenueChange, VenueRecord, Workspace, ZoneArchive, ZoneChange, ZoneRecord,
} from './apiTypes';

/** A crate delete the server refused because schedules, zone defaults or rules still use it. */
export class CrateInUseError extends Error {
  readonly status = 409;
  constructor(readonly crateId: string, readonly uses: CrateUse[]) {
    super(uses.length === 1 ? 'This crate is used in 1 place.' : `This crate is used in ${uses.length} places.`);
    this.name = 'CrateInUseError';
  }
}

const enc = encodeURIComponent;

function json(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, body: JSON.stringify(body) };
}

/** The server may answer `{venues: [...]}` or a bare list; accept both. */
function list<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const inner = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** The server may answer `{venue: {...}}` or the record itself; accept both. */
function one<T>(payload: unknown, key: string): T {
  if (payload && typeof payload === 'object' && key in payload) return (payload as Record<string, unknown>)[key] as T;
  return payload as T;
}

/** The `uses` list in a 409 body, at the top level or inside FastAPI's `detail`. */
export function usesOf(payload: unknown): CrateUse[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const top = (payload as { uses?: unknown }).uses;
  if (Array.isArray(top)) return top as CrateUse[];
  const detail = (payload as { detail?: unknown }).detail;
  if (detail && typeof detail === 'object') {
    const inner = (detail as { uses?: unknown }).uses;
    if (Array.isArray(inner)) return inner as CrateUse[];
  }
  return null;
}

/** Every workspace this person can switch to. Sends the current workspace when one is known. */
export async function listWorkspaces(api: Api, workspaceId?: string): Promise<Workspace[]> {
  return list<Workspace>(await api<unknown>('/workspaces', {}, workspaceId), 'workspaces');
}

export type BusinessApi = ReturnType<typeof businessApi>;

/** The business routes bound to one workspace: each call carries that workspace's id. */
export function businessApi(api: Api, workspaceId: string) {
  const call = <T,>(path: string, init: RequestInit = {}) => api<T>(path, init, workspaceId);
  const venueQuery = (venueId?: string | null) => (venueId ? `?venue_id=${enc(venueId)}` : '');

  return {
    workspaceId,

    listOrgs: async () => list<OrgRecord>(await call('/business/orgs'), 'orgs'),
    createOrg: async (body: { name: string; country?: string; legal_name?: string }) =>
      one<OrgRecord>(await call('/business/orgs', json('POST', body)), 'org'),
    getOrg: async (orgId: string) => one<OrgRecord>(await call(`/business/orgs/${enc(orgId)}`), 'org'),

    listVenues: async () => list<VenueRecord>(await call('/business/venues'), 'venues'),
    createVenue: async (body: NewVenue) => one<VenueRecord>(await call('/business/venues', json('POST', body)), 'venue'),
    getVenue: async (venueId: string) => one<VenueRecord>(await call(`/business/venues/${enc(venueId)}`), 'venue'),
    updateVenue: async (venueId: string, change: VenueChange) =>
      one<VenueRecord>(await call(`/business/venues/${enc(venueId)}`, json('PATCH', change)), 'venue'),
    archiveVenue: async (venueId: string, when?: 'now' | 'closing') =>
      one<VenueRecord>(await call(`/business/venues/${enc(venueId)}/archive`, json('POST', when ? { when } : {})), 'venue'),

    listZones: async (venueId: string) => list<ZoneRecord>(await call(`/business/zones${venueQuery(venueId)}`), 'zones'),
    createZone: async (venueId: string, name: string) =>
      one<ZoneRecord>(await call('/business/zones', json('POST', { venue_id: venueId, name })), 'zone'),
    updateZone: async (zoneId: string, change: ZoneChange) =>
      one<ZoneRecord>(await call(`/business/zones/${enc(zoneId)}`, json('PATCH', change)), 'zone'),
    archiveZone: async (zoneId: string, archive: ZoneArchive) =>
      one<ZoneRecord>(await call(`/business/zones/${enc(zoneId)}/archive`, json('POST', archive)), 'zone'),

    listCrates: async (venueId?: string | null) => list<Crate>(await call(`/business/crates${venueQuery(venueId)}`), 'crates'),
    createCrate: async (name: string, venueId?: string | null) =>
      one<Crate>(await call('/business/crates', json('POST', venueId ? { name, venue_id: venueId } : { name })), 'crate'),
    getCrate: async (crateId: string, venueId?: string | null) =>
      one<Crate>(await call(`/business/crates/${enc(crateId)}${venueQuery(venueId)}`), 'crate'),
    setCrateSongs: async (crateId: string, songIds: string[]) =>
      one<Crate>(await call(`/business/crates/${enc(crateId)}/songs`, json('PUT', { song_ids: songIds })), 'crate'),
    /** Deletes a crate, or throws `CrateInUseError` naming every place that still uses it. */
    deleteCrate: async (crateId: string): Promise<void> => {
      try {
        await call<unknown>(`/business/crates/${enc(crateId)}`, { method: 'DELETE' });
      } catch (problem) {
        const status = (problem as { status?: unknown })?.status;
        const uses = status === 409 ? usesOf((problem as { payload?: unknown }).payload) : null;
        if (uses) throw new CrateInUseError(crateId, uses);
        throw problem;
      }
    },
  };
}
