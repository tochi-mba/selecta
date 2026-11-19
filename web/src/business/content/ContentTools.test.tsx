// The ADR-0450 content tools under Music rules: the zone pool with its relaxations and unchecked
// count, overrides, the bulk editor with undo, the CSV import preview and "Worth checking", each
// shown only while its flag is on, and a notice instead while content controls are off.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org, venue } from '../fixtures';
import { CONTENT_ROUTES, endsWords, type ZonePool } from './contentClient';
import { ContentTools } from './ContentTools';

const POOL: ZonePool = {
  zone_id: 'camden-bar', version: 3, library: 40, unanalysed: 4,
  blocks: [
    { daypart_id: null, label: 'All day', songs: 31, hours: 1.8, unknown: 5, relaxed: ['song_spacing'], messages: ['Bar is repeating songs sooner than usual: 31 songs fit its rules'] },
    { daypart_id: 'brunch', label: 'Brunch', songs: 0, hours: 0, unknown: 0, relaxed: [], messages: [] },
  ],
  overrides: [{ id: 'o1', kind: 'artist', value: 'Loud Band', reason: 'Private event', ends_at: NOW + 3600 }],
};

function fakeApi() {
  return vi.fn(async (path: string) => {
    if (path.endsWith('/content/pool')) return POOL;
    if (path === CONTENT_ROUTES.bulkPreview) return { count: 214, changing: 200, explicit: 'clean', summary: 'Marking 214 songs as clean', songs: [] };
    if (path === CONTENT_ROUTES.bulkApply) return { batch_id: 'b1', count: 214, version: 4, summary: 'Marking 214 songs as clean' };
    if (path === CONTENT_ROUTES.bulkUndo('b1')) return { restored: 214 };
    if (path === CONTENT_ROUTES.importPreview) return { matched: [{ line: '2' }], ambiguous: [], unmatched: [{ line: '3', artist: 'Nobody', title: 'Nothing' }], invalid: [], counts: { matched: 1, ambiguous: 0, unmatched: 1, invalid: 0 } };
    if (path === CONTENT_ROUTES.worthChecking) return { worth_checking: [{ song_id: 's', title: 'Rude Song', artist: 'X', explicit: 'unknown', words: ['shit'] }], not_checked: [], checked: 10, library: 40 };
    return {};
  });
}

function show(features: Record<string, boolean>, api = fakeApi()) {
  const one = venue('camden', 'Camden');
  const value = {
    org: org({ features }), venues: [one], devices: [], activity: [], client: {} as BusinessCtx['client'],
    now: NOW, offline: false, updatedAt: NOW, health: { stream: 'live' }, loading: false, readOnly: false,
    refresh: async () => {}, go: vi.fn(), api: api as unknown as Api,
  } as BusinessCtx;
  render(<BusinessContext.Provider value={value}><ContentTools venue={{ ...one, zones: [one.zones[0]] }} disabled={null} /></BusinessContext.Provider>);
  return api;
}

describe('content tools', () => {
  it('tells managers zones refuse rather than play unchecked while content controls are off', () => {
    const api = show({});
    expect(screen.getByRole('status')).toHaveTextContent("zones won't start new music");
    expect(api).not.toHaveBeenCalled();
  });

  it('shows the pool, the relaxation, the unchecked count, an empty block and overrides', async () => {
    const api = show({ 'business.content_controls': true });
    expect(await screen.findByText('Bar is repeating songs sooner than usual: 31 songs fit its rules')).toBeInTheDocument();
    expect(screen.getByText(/5 not checked for explicit lyrics/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing can play here with these rules/)).toBeInTheDocument();
    expect(screen.getByText(/4 of 40 songs aren't analysed yet/)).toBeInTheDocument();
    expect(screen.getByText(/Loud Band allowed/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(CONTENT_ROUTES.pool('camden-bar'), undefined, org().id);
    expect(screen.queryByText('Mark many songs at once')).toBeNull();
    expect(screen.queryByText('Worth checking')).toBeNull();
  });

  it('counts, marks and undoes a bulk change', async () => {
    const api = show({ 'business.content_controls': true, 'business.content_controls.bulk': true });
    await userEvent.click(await screen.findByRole('button', { name: 'Count songs' }));
    expect(await screen.findByText('Marking 214 songs as clean')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark them' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo last change' }));
    expect(api.mock.calls.map(([path]) => path)).toContain(CONTENT_ROUTES.bulkUndo('b1'));
  });

  it('previews CSV matches before anything is saved', async () => {
    const api = show({ 'business.content_controls': true, 'business.content_controls.bulk': true });
    await userEvent.type(await screen.findByLabelText('Or paste it'), 'artist,title,explicit');
    await userEvent.click(screen.getByRole('button', { name: 'Check matches' }));
    expect(await screen.findByText(/1 matched, 0 ambiguous, 1 unmatched/)).toBeInTheDocument();
    expect(api.mock.calls.map(([path]) => path)).not.toContain(CONTENT_ROUTES.importApply);
  });

  it('lists songs worth checking without marking them', async () => {
    const api = show({ 'business.content_controls': true, 'business.content_controls.lyrics_hint': true });
    await userEvent.click(await screen.findByRole('button', { name: 'Check more songs' }));
    expect(await screen.findByText(/Rude Song by X/)).toBeInTheDocument();
    expect(api.mock.calls.map(([path]) => path).some((path) => String(path).includes('/explicit'))).toBe(false);
  });

  it('says when an override ends', () => {
    expect(endsWords(NOW + 90 * 60, NOW)).toBe('Ends in 1 h 30 min');
    expect(endsWords(NOW + 5 * 60, NOW)).toBe('Ends in 5 min');
  });
});
