import { describe, expect, it, vi } from 'vitest';
import { Api, CloudError } from '../cloud/api';
import { businessApi, CrateInUseError, listWorkspaces, usesOf } from './api';

type Call = { url: string; method: string; workspace: string | null; body: unknown };

/** The same shape as CloudApp's `api`: adds the workspace header, throws CloudError with the body. */
function harness(answers: Record<string, { status?: number; body: unknown }> = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? 'GET', workspace: headers.get('X-Workspace-ID'), body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${init.method ?? 'GET'} ${url}`] ?? { body: {} };
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  const api: Api = async <T,>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer tok');
    if (workspaceId) headers.set('X-Workspace-ID', workspaceId);
    const response = await fetchMock(`/api${path}`, { ...init, headers });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new CloudError('refused', response.status, undefined, payload);
    return payload as T;
  };
  return { api, calls };
}

describe('business api client', () => {
  it('lists workspaces with the current workspace header', async () => {
    const { api, calls } = harness({ 'GET /api/workspaces': { body: { workspaces: [{ id: 'p', name: 'Personal', kind: 'personal', role: 'owner', pilot_until: null }] } } });
    const listed = await listWorkspaces(api, 'p');
    expect(listed.map((w) => w.id)).toEqual(['p']);
    expect(calls[0]).toMatchObject({ url: '/api/workspaces', method: 'GET', workspace: 'p' });
  });

  it('sends every business route with the bound workspace id and the right path and body', async () => {
    const { api, calls } = harness();
    const biz = businessApi(api, 'org-ws');
    await biz.listOrgs();
    await biz.createOrg({ name: 'The Crown Group' });
    await biz.getOrg('o 1');
    await biz.listVenues();
    await biz.createVenue({ name: 'Shoreditch', timezone: 'Europe/London', country: 'GB' });
    await biz.getVenue('v1');
    await biz.updateVenue('v1', { status: 'paused' });
    await biz.archiveVenue('v1');
    await biz.listZones('v1');
    await biz.createZone('v1', 'Terrace');
    await biz.updateZone('z1', { name: 'Bar' });
    await biz.archiveZone('z1', { when: 'closing', closing_at: 1_800_000_000 });
    await biz.listCrates();
    await biz.listCrates('v1');
    await biz.createCrate('Brand core');
    await biz.createCrate('Friday', 'v1');
    await biz.getCrate('c1', 'v1');
    await biz.setCrateSongs('c1', ['s1', 's2']);
    await biz.deleteCrate('c1');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/business/orgs',
      'POST /api/business/orgs',
      'GET /api/business/orgs/o%201',
      'GET /api/business/venues',
      'POST /api/business/venues',
      'GET /api/business/venues/v1',
      'PATCH /api/business/venues/v1',
      'POST /api/business/venues/v1/archive',
      'GET /api/business/zones?venue_id=v1',
      'POST /api/business/zones',
      'PATCH /api/business/zones/z1',
      'POST /api/business/zones/z1/archive',
      'GET /api/business/crates',
      'GET /api/business/crates?venue_id=v1',
      'POST /api/business/crates',
      'POST /api/business/crates',
      'GET /api/business/crates/c1?venue_id=v1',
      'PUT /api/business/crates/c1/songs',
      'DELETE /api/business/crates/c1',
    ]);
    expect(calls.every((c) => c.workspace === 'org-ws')).toBe(true);
    expect(calls[4].body).toEqual({ name: 'Shoreditch', timezone: 'Europe/London', country: 'GB' });
    expect(calls[6].body).toEqual({ status: 'paused' });
    expect(calls[9].body).toEqual({ venue_id: 'v1', name: 'Terrace' });
    expect(calls[11].body).toEqual({ when: 'closing', closing_at: 1_800_000_000 });
    expect(calls[14].body).toEqual({ name: 'Brand core' });
    expect(calls[15].body).toEqual({ name: 'Friday', venue_id: 'v1' });
    expect(calls[17].body).toEqual({ song_ids: ['s1', 's2'] });
  });

  it('reads wrapped and bare answers alike', async () => {
    const { api } = harness({
      'GET /api/business/venues': { body: { venues: [{ id: 'v1', name: 'A', timezone: 'UTC', country: 'GB', status: 'active' }] } },
      'GET /api/business/venues/v1': { body: { id: 'v1', name: 'A', timezone: 'UTC', country: 'GB', status: 'active' } },
      'GET /api/business/crates': { body: [{ id: 'c1', name: 'Core', venue_id: null }] },
    });
    const biz = businessApi(api, 'w');
    expect((await biz.listVenues())[0].id).toBe('v1');
    expect((await biz.getVenue('v1')).name).toBe('A');
    expect((await biz.listCrates())[0].venue_id).toBeNull();
  });

  it('turns a 409 crate delete into CrateInUseError carrying the uses', async () => {
    const uses = [{ kind: 'schedule', label: 'Brunch (Terrace)' }, { kind: 'zone_default', label: 'Bar' }];
    const { api } = harness({ 'DELETE /api/business/crates/c1': { status: 409, body: { detail: { code: 'crate_in_use', uses } } } });
    const failure = await businessApi(api, 'w').deleteCrate('c1').catch((problem) => problem);
    expect(failure).toBeInstanceOf(CrateInUseError);
    expect((failure as CrateInUseError).uses).toEqual(uses);
    expect((failure as CrateInUseError).crateId).toBe('c1');
    expect((failure as CrateInUseError).message).toBe('This crate is used in 2 places.');
  });

  it('accepts uses at the top level and passes other refusals through', async () => {
    expect(usesOf({ uses: [{ label: 'x' }] })).toEqual([{ label: 'x' }]);
    expect(usesOf({ detail: 'nope' })).toBeNull();
    const { api } = harness({ 'DELETE /api/business/crates/c2': { status: 404, body: { detail: 'Not found' } } });
    const failure = await businessApi(api, 'w').deleteCrate('c2').catch((problem) => problem);
    expect(failure).toBeInstanceOf(CloudError);
    expect(failure).not.toBeInstanceOf(CrateInUseError);
  });
});
