import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { configureConnection, reportOffline, reportOk } from './connection';
import { withOutbox } from './outbox';
import type { Recipe, RecipeStore } from './recipeStore';
import { OfflineError } from './resilientRequest';

// A mix made offline is created when the connection is back. When the server made it but the
// answer never arrived, the queue sends the create again: it carries the local mix id as its
// Idempotency-Key, so the server (which honours the key) hands back the first mix, not a copy.

function server() {
  const mixes = new Map<string, Recipe>();
  const keys: (string | undefined)[] = [];
  let down = false;
  let loseNextAnswer = false;
  const store = {
    current: () => null,
    setCurrent: () => undefined,
    steering: () => ({ mix_language: 'any', stems: 'auto', energy_arc: null, target: null }),
    setSteering: () => undefined,
    create: async (name: string, songIds: number[], _known?: unknown, key?: string) => {
      if (down) throw new OfflineError();
      keys.push(key);
      const id = key ? `srv-${key}` : `srv-${mixes.size + 1}`;
      const made = mixes.get(id) ?? { mix_id: id, name, number: 1, parent: null, revision: `${id}-r1`, songs: songIds.map((song_id) => ({ song_id })), seams: [] } as unknown as Recipe;
      mixes.set(id, made);
      if (loseNextAnswer) { loseNextAnswer = false; throw new OfflineError(); }
      return made;
    },
    read: async (mixId: string) => { const found = mixes.get(mixId); if (!found) throw Object.assign(new Error('gone'), { status: 404 }); return found; },
    list: async () => [...mixes.values()],
    edit: async () => { throw new Error('not used'); },
    duplicate: async () => { throw new Error('not used'); },
    remove: async () => { throw new Error('not used'); },
  } as unknown as RecipeStore;
  return { store, mixes, keys, setDown: (value: boolean) => { down = value; }, loseNextAnswer: () => { loseNextAnswer = true; } };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', undefined);
  setFlags({ 'cloud.mix_outbox': true });
  configureConnection({ reset: true, probe: async () => false });
});
afterEach(() => {
  configureConnection({ reset: true, probe: async () => false });
  vi.unstubAllGlobals();
});

describe('a mix made offline', () => {
  it('is sent with its local id as the key, so a lost answer never makes a second mix', async () => {
    const remote = server();
    const box = withOutbox(remote.store, 'ws-idempotent-create');
    remote.setDown(true);
    reportOffline();
    const local = await box.create('Made on the train', [1, 2, 3]);
    remote.setDown(false);
    reportOk();
    remote.loseNextAnswer();
    await box.flush?.();
    await box.flush?.();
    expect(remote.keys.length).toBe(2);
    expect(remote.keys).toEqual([local.mix_id, local.mix_id]);
    expect(remote.mixes.size).toBe(1);
  });
});
