import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { configureConnection, reportOffline, reportOk } from './connection';
import { takeOutboxNotices, withOutbox } from './outbox';
import type { Recipe, RecipeStore } from './recipeStore';
import { OfflineError } from './resilientRequest';

// A mix deleted offline that this browser had never opened or listed has no revision to compare
// on reconnect. The empty revision never matched the server's, so the delete was dropped and the
// member was told the mix "changed on another device", which it had not.

function server() {
  const recipe: Recipe = { mix_id: 'srv-1', name: 'Never opened here', number: 1, parent: null, revision: 'srv-1-r4', songs: [], seams: [] };
  const mixes = new Map<string, Recipe>([[recipe.mix_id, recipe]]);
  let down = false;
  const guard = () => { if (down) throw new OfflineError(); };
  const store = {
    current: () => null,
    setCurrent: () => undefined,
    steering: () => ({ mix_language: 'any', stems: 'auto', energy_arc: null, target: null }),
    setSteering: () => undefined,
    create: async () => { throw new Error('not used'); },
    read: async (mixId: string) => { guard(); const found = mixes.get(mixId); if (!found) throw Object.assign(new Error('gone'), { status: 404 }); return found; },
    list: async () => { guard(); return []; },
    edit: async () => { throw new Error('not used'); },
    duplicate: async () => { throw new Error('not used'); },
    remove: async (mixId: string) => { guard(); mixes.delete(mixId); },
  } as unknown as RecipeStore;
  return { store, mixes, setDown: (value: boolean) => { down = value; } };
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

describe('a delete made offline with no revision known here', () => {
  it('is carried out on reconnect, and nothing is said about another device', async () => {
    const remote = server();
    const box = withOutbox(remote.store, 'ws-unknown-revision');
    remote.setDown(true);
    reportOffline();
    expect(await box.remove('srv-1')).toBe('queued');
    await box.flush?.();
    remote.setDown(false);
    reportOk();
    await box.flush?.();
    expect(remote.mixes.has('srv-1')).toBe(false);
    expect(takeOutboxNotices('ws-unknown-revision')).toEqual([]);
  });
});
