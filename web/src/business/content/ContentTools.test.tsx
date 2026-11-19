// The ADR-0450 content tools under Music rules: the zone pool with its relaxations and unchecked
// count, overrides, the bulk editor with undo, the CSV import preview and "Worth checking", each
// shown only while its flag is on; with content controls off the tools disappear.
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
  let sheetMark = 'unknown';
  return vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/content/pool')) return POOL;
    if (path === CONTENT_ROUTES.blocklist && !init?.method) return { entries: [{ id: 'e1', kind: 'album', value: 'loud', label: 'Loud Album', scope: 'venue', scope_id: 'camden', reason: 'Brand', ends_at: null }] };
    if (path === CONTENT_ROUTES.blocklist) return { id: 'e2', ended_overrides: [] };
    if (path.startsWith('/business/content/artist-variants')) return { variants: ['Beyoncé', 'Beyoncé feat. Jay-Z'] };
    if (path.startsWith('/business/content/songs/s1') && !init?.method) return { song_id: 's1', title: 'Golden Hour', artist: 'Beyoncé', explicit: sheetMark, source: 'tag', clean_song_id: null };
    if (path.startsWith('/business/content/songs/s1')) { sheetMark = JSON.parse(String(init?.body)).explicit ?? sheetMark; return { version: 2 }; }
    if (path === CONTENT_ROUTES.bulkPreview) return { count: 214, changing: 200, explicit: 'clean', summary: 'Marking 214 songs as clean', songs: [] };
    if (path === CONTENT_ROUTES.bulkApply) return { batch_id: 'b1', count: 214, version: 4, summary: 'Marking 214 songs as clean' };
    if (path === CONTENT_ROUTES.bulkUndo('b1')) return { restored: 214 };
    if (path === CONTENT_ROUTES.importPreview) return { matched: [{ line: '2' }], ambiguous: [], unmatched: [{ line: '3', artist: 'Nobody', title: 'Nothing' }], invalid: [], counts: { matched: 1, ambiguous: 0, unmatched: 1, invalid: 0 } };
    if (path === CONTENT_ROUTES.worthChecking) return { worth_checking: [{ song_id: 's', title: 'Rude Song', artist: 'X', explicit: 'unknown', words: ['shit'] }], not_checked: [], checked: 10, library: 40 };
    return {};
  });
}

function show(features: Record<string, boolean>, api = fakeApi(), role: 'owner' | 'staff' = 'owner') {
  const one = venue('camden', 'Camden');
  const value = {
    org: org({ features, role }), venues: [one], devices: [], activity: [],
    client: { librarySongs: async () => [{ id: 's1', title: 'Golden Hour', artist: 'Beyoncé', explicit: 'unknown' }, { id: 's2', title: 'Golden Hour (Clean)', artist: 'Beyoncé', explicit: 'clean' }] } as unknown as BusinessCtx['client'],
    now: NOW, offline: false, updatedAt: NOW, health: { stream: 'live' }, loading: false, readOnly: false,
    refresh: async () => {}, go: vi.fn(), api: api as unknown as Api,
  } as BusinessCtx;
  render(<BusinessContext.Provider value={value}><ContentTools venue={{ ...one, zones: [one.zones[0]] }} disabled={null} /></BusinessContext.Provider>);
  return api;
}

describe('content tools', () => {
  it('disappears while content controls are off', () => {
    const api = show({});
    expect(screen.queryByText('What each zone can play')).toBeNull();
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

  it('shows every artist spelling before an artist can be blocked, and lists album entries', async () => {
    const api = show({ 'business.content_controls': true });
    expect(await screen.findByText(/Album: Loud Album/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Artist to block'), 'Beyonce');
    const add = screen.getByRole('button', { name: 'Add to the blocklist' });
    expect(add).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Check spellings' }));
    expect(await screen.findByText('Beyoncé feat. Jay-Z')).toBeInTheDocument();
    await userEvent.click(add);
    const posted = api.mock.calls.find(([path, init]) => path === CONTENT_ROUTES.blocklist && (init as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((posted?.[1] as RequestInit).body))).toMatchObject({ kind: 'artist', value: 'Beyonce', scope: 'venue', scope_id: 'camden' });
  });

  it('opens a song sheet and marks the song, with the clean edit picker', async () => {
    const api = show({ 'business.content_controls': true });
    await userEvent.type(await screen.findByLabelText('Find a song'), 'golden');
    await userEvent.click(await screen.findByRole('button', { name: 'Golden Hour by Beyoncé' }));
    expect(await screen.findByText("Marked by the file's own tags.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Explicit lyrics'), 'explicit');
    expect(api.mock.calls.some(([path, init]) => path === CONTENT_ROUTES.songFlag('s1') && (init as RequestInit | undefined)?.method === 'PUT')).toBe(true);
    expect(screen.getByLabelText('Clean edit')).toHaveTextContent('Golden Hour (Clean) by Beyoncé');
  });

  it('shows the song sheet read-only to staff', async () => {
    show({ 'business.content_controls': true }, fakeApi(), 'staff');
    await userEvent.type(await screen.findByLabelText('Find a song'), 'golden');
    await userEvent.click(await screen.findByRole('button', { name: 'Golden Hour by Beyoncé' }));
    expect(await screen.findByLabelText('Explicit lyrics')).toBeDisabled();
    expect(screen.getByText('Venue managers and above can change this.')).toBeInTheDocument();
  });

  it('says when an override ends', () => {
    expect(endsWords(NOW + 90 * 60, NOW)).toBe('Ends in 1 h 30 min');
    expect(endsWords(NOW + 5 * 60, NOW)).toBe('Ends in 5 min');
  });
});
