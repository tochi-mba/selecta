import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData } from '../api';
import { setFlags } from '../flags';
import { configureConnection, reportOffline, reportOk } from './connection';
import { NOT_DELETED, outboxWaiting, SAVED_AS_COPY, takeOutboxNotices, WAITING_TO_SYNC, withOutbox } from './outbox';
import type { Recipe, RecipeStore, RecipeSummary } from './recipeStore';
import { OfflineError } from './resilientRequest';
import { SavedBrowserMixes } from './SavedBrowserMixes';

// The mix outbox (cloud.mix_outbox): mixes made, edited, copied or deleted offline are applied
// here at once and sent in order on reconnect; a mix that changed on another device keeps the
// member's version as a copy; a delete can be taken back until it is sent.

const song = (id: number) => ({ song_id: id, id: String(id), title: `Song ${id}`, artist: 'A', duration: 200, sha256: null, in_library: true, available_on: 1 });

/** A server that knows revisions: an edit on an old one is refused as stale_revision. */
function server() {
  const mixes = new Map<string, Recipe>();
  let made = 0;
  let current: string | null = null;
  const log: string[] = [];
  let down = false;
  const guard = () => { if (down) throw new OfflineError(); };
  const bump = (recipe: Recipe): Recipe => ({ ...recipe, revision: `${recipe.mix_id}-r${Number(recipe.revision.split('-r')[1] ?? 0) + 1}` });
  const store: RecipeStore = {
    current: () => current,
    setCurrent: (mixId) => { current = mixId; },
    steering: () => ({ mix_language: 'any', stems: 'auto', energy_arc: null, target: null }),
    setSteering: () => undefined,
    create: async (name, songIds) => {
      guard();
      made += 1;
      const recipe: Recipe = { mix_id: `srv-${made}`, name, number: made, parent: null, revision: `srv-${made}-r1`, songs: songIds.map(song), seams: [] };
      mixes.set(recipe.mix_id, recipe);
      log.push(`create ${name} [${songIds.join(',')}]`);
      return recipe;
    },
    read: async (mixId) => {
      guard();
      const found = mixes.get(mixId);
      if (!found) throw Object.assign(new Error('gone'), { status: 404 });
      return found;
    },
    list: async () => {
      guard();
      return [...mixes.values()].map((recipe): RecipeSummary => ({ mix_id: recipe.mix_id, name: recipe.name, revision: recipe.revision, number: recipe.number, songs: recipe.songs.length, updated_at: 1 }));
    },
    edit: async (mixId, baseRevision, change) => {
      guard();
      const found = mixes.get(mixId);
      if (!found) throw Object.assign(new Error('gone'), { status: 404 });
      if (found.revision !== baseRevision) throw Object.assign(new Error('changed'), { code: 'stale_revision', status: 409 });
      const next = bump({ ...found, name: change.name ?? found.name, songs: change.songIds ? change.songIds.map(song) : found.songs });
      mixes.set(mixId, next);
      log.push(`edit ${mixId}@${baseRevision}${change.name ? ` name=${change.name}` : ''}${change.songIds ? ` songs=${change.songIds.join(',')}` : ''}`);
      return next;
    },
    duplicate: async (mixId, name) => {
      guard();
      const found = mixes.get(mixId)!;
      return store.create(name ?? `${found.name} (copy)`, found.songs.map((one) => one.song_id));
    },
    remove: async (mixId) => {
      guard();
      mixes.delete(mixId);
      log.push(`remove ${mixId}`);
    },
  };
  return {
    store, mixes, log,
    setDown: (value: boolean) => { down = value; },
    /** Another device edits the mix: its revision moves on. */
    changeElsewhere: (mixId: string) => { mixes.set(mixId, bump(mixes.get(mixId)!)); },
  };
}

let counter = 0;
const fresh = () => `ws-outbox-${++counter}`;

function goOffline(remote: ReturnType<typeof server>) {
  remote.setDown(true);
  reportOffline();
}
async function comeBack(remote: ReturnType<typeof server>, box: RecipeStore) {
  // time passes offline: any attempt a change started while offline has ended
  await box.flush?.();
  remote.setDown(false);
  reportOk();
  await box.flush?.();
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', undefined);
  configureConnection({ reset: true, probe: async () => false });
});

afterEach(() => {
  configureConnection({ reset: true, probe: async () => false });
});

describe('the mix outbox', () => {
  it('a mix made offline shows at once as waiting, and is made on the server on reconnect', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    goOffline(remote);
    const made = await box.create('Late set', [1, 2], [{ id: 1, title: 'One', artist: null, duration: 100 }]);
    expect(made.mix_id).toMatch(/^local-/);
    expect(made.songs[0].title).toBe('One');
    box.setCurrent(made.mix_id);
    expect(await outboxWaiting(workspaceId)).toBe(1);
    const offlineList = await box.list();
    expect(offlineList).toEqual([expect.objectContaining({ mix_id: made.mix_id, name: 'Late set', pending: true })]);

    await comeBack(remote, box);
    expect(remote.log).toEqual(['create Late set [1,2]']);
    expect(await outboxWaiting(workspaceId)).toBe(0);
    expect(box.current()).toBe('srv-1');
    expect((await box.list()).every((one) => !one.pending)).toBe(true);
    // the local id still finds the mix
    expect((await box.read(made.mix_id)).mix_id).toBe('srv-1');
  });

  it('edits made offline are sent in the order they were made, each on the revision before it', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const mix = await box.create('Friday', [1, 2, 3]);
    await box.list();
    goOffline(remote);
    const first = await box.edit(mix.mix_id, mix.revision, { name: 'Friday warmup' });
    const second = await box.edit(mix.mix_id, first.revision, { songIds: [3, 1] });
    expect(second.name).toBe('Friday warmup');
    expect(second.songs.map((one) => one.song_id)).toEqual([3, 1]);
    expect((await box.read(mix.mix_id)).name).toBe('Friday warmup');
    expect((await box.list())[0]).toMatchObject({ pending: true });

    await comeBack(remote, box);
    expect(remote.log.slice(1)).toEqual([`edit ${mix.mix_id}@${mix.revision} name=Friday warmup`, `edit ${mix.mix_id}@${mix.mix_id}-r2 songs=3,1`]);
    expect(remote.mixes.get(mix.mix_id)).toMatchObject({ name: 'Friday warmup', revision: `${mix.mix_id}-r3` });
  });

  it('a mix that changed on another device meanwhile keeps the member’s version as a copy', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const mix = await box.create('Sunday', [1, 2]);
    goOffline(remote);
    await box.edit(mix.mix_id, mix.revision, { songIds: [2, 1] });
    remote.changeElsewhere(mix.mix_id);

    await comeBack(remote, box);
    expect(remote.log).toContain('create Sunday (copy) [2,1]');
    expect(remote.mixes.get(mix.mix_id)?.songs.map((one) => one.song_id)).toEqual([1, 2]);
    expect(takeOutboxNotices(workspaceId)).toEqual([SAVED_AS_COPY]);
    expect(await outboxWaiting(workspaceId)).toBe(0);
  });

  it('a copy made offline is queued from this browser’s version', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const mix = await box.create('Party', [4, 5]);
    goOffline(remote);
    const copy = await box.duplicate(mix.mix_id);
    expect(copy.mix_id).toMatch(/^local-/);
    expect(copy.name).toBe('Party (copy)');
    await comeBack(remote, box);
    expect(remote.log).toContain('create Party (copy) [4,5]');
  });

  it('a delete offline hides the mix at once and can be undone until it is sent', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const mix = await box.create('Keep me', [1]);
    await box.list();
    goOffline(remote);
    expect(await box.remove(mix.mix_id)).toBe('queued');
    expect(await box.list()).toEqual([]);
    await box.restore?.(mix.mix_id);
    expect((await box.list()).map((one) => one.mix_id)).toEqual([mix.mix_id]);
    await comeBack(remote, box);
    expect(remote.log).not.toContain(`remove ${mix.mix_id}`);
    expect(remote.mixes.has(mix.mix_id)).toBe(true);
  });

  it('a delete offline is sent on reconnect, unless the mix changed elsewhere, which keeps it and says so', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const gone = await box.create('Gone', [1]);
    const kept = await box.create('Kept', [2]);
    await box.list();
    goOffline(remote);
    await box.remove(gone.mix_id);
    await box.remove(kept.mix_id);
    remote.changeElsewhere(kept.mix_id);
    await comeBack(remote, box);
    expect(remote.mixes.has(gone.mix_id)).toBe(false);
    expect(remote.mixes.has(kept.mix_id)).toBe(true);
    expect(takeOutboxNotices(workspaceId)).toEqual([NOT_DELETED]);
  });

  it('a mix made and deleted offline never reaches the server', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    goOffline(remote);
    const made = await box.create('Oops', [1]);
    await box.remove(made.mix_id);
    await comeBack(remote, box);
    expect(remote.log).toEqual([]);
    expect(await outboxWaiting(workspaceId)).toBe(0);
  });

  it('the current mix opens offline from the copy kept when it was last read', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const mix = await box.create('Tonight', [1, 2]);
    await box.read(mix.mix_id);
    goOffline(remote);
    expect((await box.read(mix.mix_id)).name).toBe('Tonight');
  });

  it('with cloud.mix_outbox off every call goes straight to the server', async () => {
    setFlags({ 'cloud.mix_outbox': false });
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    goOffline(remote);
    await expect(box.create('No queue', [1])).rejects.toBeInstanceOf(OfflineError);
    expect(await outboxWaiting(workspaceId)).toBe(0);
  });
});

describe('My Mixes with the outbox', () => {
  it('marks a mix waiting to sync, and a delete offline offers Undo', async () => {
    const workspaceId = fresh();
    const remote = server();
    const box = withOutbox(remote.store, workspaceId);
    const saved = await box.create('Saved', [1]);
    await box.list();
    goOffline(remote);
    await box.create('Made offline', [2]);
    const notify = vi.fn();
    render(
      <SavedBrowserMixes workspaceId={workspaceId} recipes={box} request={vi.fn(async () => ({ mix: [], name: 'Current mix', can_undo: false } as MixData)) as never}
        setMixData={vi.fn()} refreshStatus={() => undefined} player={{ playFrom: vi.fn() } as never} notify={notify} />,
    );
    expect(await screen.findByText(WAITING_TO_SYNC)).toBeVisible();
    expect(screen.getByText(/Saved on this device; it goes to your account when the connection is back\./)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Saved' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete Saved/ }));
    const confirm = screen.getAllByRole('button').find((button) => /^Delete/.test(button.textContent ?? '') && button.getAttribute('role') !== 'menuitem');
    await userEvent.click(confirm!);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Deleted Saved. This reaches your account when the connection is back.', expect.any(Function)));
    const undo = notify.mock.calls.at(-1)![1] as () => Promise<void>;
    await act(async () => { await undo(); });
    expect((await box.list()).some((one) => one.mix_id === saved.mix_id)).toBe(true);
  });
});
