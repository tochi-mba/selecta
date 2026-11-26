import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { RequestContext } from '../requestContext';
import { status } from '../test/backend';
import type { ViewProps } from '../views/shared';
import { CloudError } from './api';
import { CloudShellPages, type CloudShellPagesContext } from './CloudShellPages';
import { deviceMusicRequest } from './deviceMusicRequest';
import type { RecipeStore } from './recipeStore';

// cloud.account_mixes: My Mixes lists the account's drafts with the Desktop's own list, and the
// draft editor route opens one, each action through the account's routes (AccountDrafts.tsx),
// asked through the shell's real request adapter. Off, both are as they were.

type Draft = { id: number; name: string; songs: number[] };

const item = (song_id: number, position: number): MixItem => ({
  position, song_id, artist: `Artist ${song_id}`, title: `Song ${song_id}`, duration: 200, bpm: null, key: null, locked: false,
  seam: position ? { settings: { move: 'auto' }, state: { status: 'none', key: `k${song_id}` } } : null,
} as MixItem);

/** A pretend account keeping the mix: the current mix, two drafts, Undo and deleted drafts. */
function account() {
  const asked: { call: string; body: unknown }[] = [];
  let current: Omit<Draft, 'id'> = { name: 'Friday', songs: [1, 2] };
  const undo: Omit<Draft, 'id'>[] = [];
  let drafts: Draft[] = [{ id: 5, name: 'Warm up', songs: [3, 4] }, { id: 6, name: 'Peak', songs: [1, 3] }];
  const deleted: Draft[] = [];
  const mixOf = (mix: Omit<Draft, 'id'>, canUndo: boolean): MixData => ({ mix: mix.songs.map(item), name: mix.name, can_undo: canUndo });
  const summary = (draft: Draft) => ({ id: draft.id, name: draft.name, songs: draft.songs.length, seconds: 200 * draft.songs.length, seams: draft.songs.length - 1, ready: 0, failed: 0, waiting: draft.songs.length - 1, rendering: false, place: null, eta: null, to_render: 0, missing: 0, song_ids: draft.songs });
  const find = (id: string | number) => {
    const found = drafts.find((draft) => draft.id === Number(id));
    if (!found) throw new CloudError('That draft isn’t there any more.', 404);
    return found;
  };
  const cloud = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    asked.push({ call: `${method} ${path}`, body });
    const [route, query = ''] = path.split('?');
    const search = new URLSearchParams(query);
    if (method === 'GET' && route === '/mix') return search.has('draft') ? { ...mixOf(find(search.get('draft')!), true), draft: { id: Number(search.get('draft')), place: null } } : mixOf(current, undo.length > 0);
    if (method === 'GET' && route === '/drafts') return { drafts: drafts.map(summary), current: { name: current.name, songs: current.songs.length, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false };
    if (method === 'GET' && route === '/drafts/names') return { drafts: drafts.map(({ id, name }) => ({ id, name })), current: { name: current.name } };
    const at = /^\/drafts\/(\d+)\/(play|name|duplicate)$/.exec(route);
    if (method === 'POST' && at?.[2] === 'play') {
      const draft = find(at[1]);
      undo.push(current);
      drafts = [...drafts.filter((one) => one !== draft), { id: 9, name: current.name, songs: current.songs }];
      current = { name: draft.name, songs: draft.songs };
      return mixOf(current, true);
    }
    if (method === 'POST' && at?.[2] === 'name') {
      drafts = drafts.map((one) => (one.id === Number(at[1]) ? { ...one, name: String(body?.name) } : one));
      return { id: Number(at[1]), name: String(body?.name) };
    }
    if (method === 'POST' && at?.[2] === 'duplicate') {
      const copy = { ...find(at[1]), id: 7 };
      copy.name = `${copy.name} copy`;
      drafts = [...drafts, copy];
      return { id: copy.id, name: copy.name };
    }
    if (method === 'DELETE' && /^\/drafts\/\d+$/.test(route)) {
      const draft = find(route.split('/')[2]);
      drafts = drafts.filter((one) => one !== draft);
      deleted.push(draft);
      return { name: draft.name };
    }
    if (method === 'POST' && route === '/drafts/restore') {
      const back = deleted.find((one) => one.id === Number(search.get('id')))!;
      drafts = [...drafts, back];
      return { id: back.id, name: back.name };
    }
    if (method === 'POST' && route === '/mix/undo') {
      if (search.has('draft')) return { ...mixOf(find(search.get('draft')!), false), undone: 'changing the order' };
      current = undo.pop() ?? current;
      return { ...mixOf(current, undo.length > 0), undone: 'playing' };
    }
    throw new CloudError(`Not here: ${method} ${path}`, 404);
  }) as Request;
  return { cloud, asked, calls: () => asked.map((one) => one.call) };
}

function pages(route: CloudShellPagesContext['route'], world = account()) {
  const request = deviceMusicRequest(world.cloud, { workspaceId: 'ws' });
  const player = new SetPlayer(() => [], () => {});
  const playFrom = vi.spyOn(player, 'playFrom').mockResolvedValue(undefined as never);
  const setMixData = vi.fn();
  const notify = vi.fn();
  const shared: ViewProps = {
    status: status(), mix: [item(1, 0), item(2, 1)], mixName: 'Friday', canUndo: false,
    refreshMix: () => {}, setMixData, refreshStatus: () => {}, request, player, now: player.state,
    setView: () => {}, notify, stage: false, toggleStage: () => {}, analysisAvailable: false,
  };
  const recipes = { current: () => null, setCurrent: vi.fn(), list: async () => [], read: vi.fn() } as unknown as RecipeStore;
  const at = {
    route, shared, request, cloud: world.cloud, workspaceId: 'ws', on: () => true, recipes,
    data: { mix: shared.mix, name: 'Friday', can_undo: false }, setMixData, shellPlayer: player, notify,
    refreshStatus: () => {}, refreshMix: () => {}, now: player.state, playback: { view: null },
    newMember: false, workspacePage: false, browserHarmonic: false, coexisting: false, localExport: null, mixProblem: false,
  } as unknown as CloudShellPagesContext;
  render(<RequestContext.Provider value={request}><CloudShellPages at={at} /></RequestContext.Provider>);
  return { world, setMixData, notify, playFrom };
}

const ON = { 'cloud.brain': true, 'cloud.account_mixes': true, render_line: false };

beforeEach(() => {
  setFlags(ON);
  window.localStorage.setItem('selecta.device.ws', 'dev-1');
});
afterEach(() => {
  cleanup();
  setFlags(null);
  window.localStorage.clear();
});

describe('My Mixes with the account keeping the mix', () => {
  it('lists the current mix and the account’s drafts, not the saved browser mixes', async () => {
    pages({ page: 'mixes', tab: 'mine' } as never);
    const list = await screen.findByRole('region', { name: 'Your drafts' });
    expect(within(list).getByText('Warm up')).toBeVisible();
    expect(within(list).getByText('Peak')).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Saved mixes/ })).toBeNull();
  });

  it('Play makes the draft current, starts it, and Undo puts the one before back', async () => {
    const { world, setMixData, notify, playFrom } = pages({ page: 'mixes', tab: 'mine' } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Warm up' }));
    await waitFor(() => expect(playFrom).toHaveBeenCalledWith(0));
    expect(world.calls()).toContain('POST /drafts/5/play?device_id=dev-1');
    expect(setMixData).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Warm up' }));
    expect(window.location.pathname).toBe('/listen');
    const [words, undo] = notify.mock.calls.at(-1)!;
    expect(words).toBe('Now playing Warm up. What was playing is kept in your drafts.');
    await act(async () => { await (undo as () => Promise<void>)(); });
    expect(world.calls()).toContain('POST /mix/undo?device_id=dev-1');
    expect(setMixData).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Friday' }));
  });

  it('Edit opens the draft in the editor', async () => {
    pages({ page: 'mixes', tab: 'mine' } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Warm up' }));
    expect(window.location.pathname).toBe('/mixes/drafts/5/edit');
  });

  it('renames a draft through the account', async () => {
    const { world } = pages({ page: 'mixes', tab: 'mine' } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Peak' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename Peak' }));
    const field = screen.getByRole('textbox', { name: 'Name this draft' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Peak time{Enter}');
    expect(await screen.findByText('Peak time')).toBeVisible();
    expect(world.asked).toContainEqual({ call: 'POST /drafts/6/name', body: { name: 'Peak time' } });
  });

  it('copies a draft through the account', async () => {
    const { world, notify } = pages({ page: 'mixes', tab: 'mine' } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Peak' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy Peak' }));
    expect(await screen.findByText('Peak copy')).toBeVisible();
    expect(world.calls()).toContain('POST /drafts/6/duplicate');
    expect(notify).toHaveBeenCalledWith('Made a copy: Peak copy.');
  });

  it('deletes a draft, and its Undo brings that draft back', async () => {
    const { world, notify } = pages({ page: 'mixes', tab: 'mine' } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Warm up' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Warm up' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Warm up?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Deleted Warm up.', expect.any(Function)));
    expect(world.calls()).toContain('DELETE /drafts/5');
    await waitFor(() => expect(screen.queryByText('Warm up')).toBeNull());
    const undo = notify.mock.calls.find(([words]) => words === 'Deleted Warm up.')![1] as () => Promise<void>;
    await act(async () => { await undo(); });
    expect(world.calls()).toContain('POST /drafts/restore?id=5');
    expect(await screen.findByText('Warm up')).toBeVisible();
  });

  it('with account mixes off, My Mixes lists the saved browser mixes as before', async () => {
    setFlags({ ...ON, 'cloud.account_mixes': false });
    const { world } = pages({ page: 'mixes', tab: 'mine' } as never);
    expect(await screen.findByRole('heading', { name: /Saved mixes/ })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Your drafts' })).toBeNull();
    expect(world.calls().filter((call) => call.includes('/drafts'))).toEqual([]);
  });
});

describe('the draft editor route', () => {
  it('opens an account draft and edits it through ?draft=', async () => {
    const { world } = pages({ page: 'edit', draft: 5 });
    expect(await screen.findAllByText('Song 3')).not.toHaveLength(0);
    expect(world.calls()).toContain('GET /mix?draft=5');
    const [undo] = await screen.findAllByRole('button', { name: /^Undo/ });
    await userEvent.click(undo);
    await waitFor(() => expect(world.calls()).toContain('POST /mix/undo?draft=5'));
    expect(world.calls().filter((call) => call.startsWith('POST /mix/undo?device'))).toEqual([]);
  });

  it('says so when that draft is gone', async () => {
    pages({ page: 'edit', draft: 42 });
    expect(await screen.findByRole('heading', { name: 'That draft isn’t there any more.' })).toBeVisible();
  });

  it('with account mixes off, a draft’s editor is the app’s, as before', async () => {
    setFlags({ ...ON, 'cloud.account_mixes': false });
    const { world } = pages({ page: 'edit', draft: 5 });
    expect(await screen.findByText(/Editing a saved draft is part of SelectaDJ on your computer/)).toBeVisible();
    expect(world.calls()).toEqual([]);
  });
});
