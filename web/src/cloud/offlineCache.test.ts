import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Status } from '../api';
import { cloudAccount } from '../test/cloudAccount';
import { CloudError } from './api';
import { fakeIndexedDb, type FakeIndexedDb } from '../media/fakeIndexedDb';
import { configureConnection } from './connection';
import { forgetWorkspaceOnDevice } from './deviceData';
import { localFirstRequest, mergeSongs, type CatalogueSong } from './localFirstRequest';
import {
  CATALOGUE_DB_PREFIX, checkedAt, forgetAccountSnapshot, forgetCached, readCached, rememberAccount, rememberedAccount, writeCached,
} from './offlineCache';
import { CLOUD_SHELL_CACHE, CLOUD_SW_URL, syncOfflineShell } from './offlineShell';
import { OfflineError } from './resilientRequest';

// What the browser keeps so Cloud opens offline (cloud.offline_shell): the last catalogue per
// workspace, served with this device's own songs while the server can't be reached; the last
// account for the signed-in person only, forgotten on every way out; and the app-shell worker,
// registered with the flag on and removed with it off.

let idb: FakeIndexedDb;
beforeEach(() => {
  idb = fakeIndexedDb();
  vi.stubGlobal('indexedDB', idb);
  configureConnection({ reset: true, probe: async () => false });
});

afterEach(() => {
  configureConnection({ reset: true, probe: async () => false });
});

const song = (id: number, title = `Song ${id}`): CatalogueSong => ({ id, title, artist: 'A', available_on: 1 } as CatalogueSong);

describe('the kept catalogue', () => {
  it('keeps the last answer per workspace and forgets it on request', async () => {
    await writeCached('ws-c1', 'catalogue', [song(1)]);
    expect((await readCached<CatalogueSong[]>('ws-c1', 'catalogue'))?.value).toEqual([song(1)]);
    expect(await readCached('ws-c2', 'catalogue')).toBeNull();
    await forgetCached('ws-c1');
    expect(idb.names()).not.toContain(`${CATALOGUE_DB_PREFIX}-ws-c1`);
  });

  it('never throws where the browser has no storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(writeCached('ws-none', 'catalogue', [])).resolves.toBeUndefined();
    await expect(readCached('ws-none', 'catalogue')).resolves.toBeNull();
  });

  it('adds songs imported here after the last server answer; the kept row wins', () => {
    expect(mergeSongs([song(1, 'Kept')], [song(1, 'Device'), song(2)]).map((one) => one.title)).toEqual(['Kept', 'Song 2']);
  });

  it('the library is served from this device when the server cannot be reached, and says so', async () => {
    const served: unknown[] = [];
    let down = false;
    const cloud = (async (path: string) => {
      if (down) throw new OfflineError();
      if (path.startsWith('/local-media/songs')) return { songs: [song(1), song(2)] };
      throw new CloudError('nope', 404);
    }) as Request;
    const sources = { workspaceId: 'ws-c3', offline: { deviceSongs: async () => [song(3)], onServed: (from: unknown) => served.push(from) } };
    const first = localFirstRequest(cloud, sources);
    expect((await first<Status>('/status')).counts.total).toBe(2);
    expect(served.at(-1)).toEqual({ cached: false });
    await vi.waitFor(async () => expect(await readCached('ws-c3', 'catalogue')).not.toBeNull());

    down = true;
    const offline = localFirstRequest(cloud, sources);
    expect((await offline<Status>('/status')).counts.total).toBe(3);
    expect(served.at(-1)).toEqual({ cached: true, at: expect.any(Number) });
  });

  it('a refusal or an ended sign-in still throws; nothing kept is served for it', async () => {
    await writeCached('ws-c4', 'catalogue', [song(1)]);
    const cloud = (async () => { throw new CloudError('Sign in', 401); }) as Request;
    const request = localFirstRequest(cloud, { workspaceId: 'ws-c4', offline: {} });
    await expect(request('/status')).rejects.toMatchObject({ status: 401 });
  });

  it('says when the library was last checked, today or another day', () => {
    const at = new Date(2026, 10, 3, 14, 5).getTime();
    expect(checkedAt(at, at + 1_000)).not.toMatch(/Nov|3/);
    expect(checkedAt(at, at + 3 * 86_400_000)).toMatch(/3/);
  });
});

describe('the kept account', () => {
  const account = cloudAccount();

  it('is only for the person it was kept for, and only the last one', () => {
    rememberAccount('user-1', account);
    expect(rememberedAccount('user-1')?.value.workspace.id).toBe(account.workspace.id);
    expect(rememberedAccount('user-2')).toBeNull();
    const other = { ...account, workspace: { ...account.workspace, id: 'ws-other' } };
    rememberAccount('user-2', other);
    expect(rememberedAccount('user-1')).toBeNull();
    expect(rememberedAccount()?.value.workspace.id).toBe('ws-other');
  });

  it('every sign-out path forgets it; forgetting another workspace leaves it', () => {
    rememberAccount('user-1', account);
    forgetAccountSnapshot('some-other-workspace');
    expect(rememberedAccount('user-1')).not.toBeNull();
    forgetAccountSnapshot(account.workspace.id);
    expect(rememberedAccount('user-1')).toBeNull();
    rememberAccount('user-1', account);
    forgetAccountSnapshot();
    expect(rememberedAccount()).toBeNull();
  });

  it('forgetting the workspace on this device forgets the kept catalogue and account', async () => {
    rememberAccount('user-1', account);
    await writeCached(account.workspace.id, 'catalogue', [song(1)]);
    await forgetWorkspaceOnDevice(account.workspace.id);
    expect(rememberedAccount()).toBeNull();
    expect(idb.names()).not.toContain(`${CATALOGUE_DB_PREFIX}-${account.workspace.id}`);
  });

  it('broken storage is never an error', () => {
    localStorage.setItem('selecta.account-snapshot', 'not json');
    expect(rememberedAccount()).toBeNull();
    expect(() => forgetAccountSnapshot()).not.toThrow();
  });
});

describe('the app-shell worker', () => {
  function container() {
    const posted: unknown[] = [];
    const cloudWorker = { active: { scriptURL: `https://selecta.test${CLOUD_SW_URL}`, postMessage: (message: unknown) => posted.push(message) }, unregister: vi.fn(async () => true) };
    const kioskWorker = { active: { scriptURL: 'https://selecta.test/kiosk-sw.js' }, unregister: vi.fn(async () => true) };
    return {
      posted, cloudWorker, kioskWorker,
      register: vi.fn(async () => cloudWorker),
      getRegistrations: vi.fn(async () => [cloudWorker, kioskWorker]),
      ready: Promise.resolve(cloudWorker),
    };
  }

  it('registers at the root with the flag on and warms the shell files; off, removes only the Cloud worker and its cache', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', { delete: async (name: string) => { deleted.push(name); return true; } });
    const worker = container();
    await syncOfflineShell(true, worker);
    expect(worker.register).toHaveBeenCalledWith(CLOUD_SW_URL, { scope: '/' });
    expect(worker.posted[0]).toMatchObject({ type: 'cloud-shell-warm', urls: expect.any(Array) });
    // the same decision again does nothing
    await syncOfflineShell(true, worker);
    expect(worker.register).toHaveBeenCalledTimes(1);

    await syncOfflineShell(false, worker);
    expect(worker.cloudWorker.unregister).toHaveBeenCalled();
    expect(worker.kioskWorker.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual([CLOUD_SHELL_CACHE]);
  });

  it('a browser that refuses service workers simply has none, and may be asked again', async () => {
    const worker = container();
    worker.register.mockRejectedValueOnce(new Error('refused'));
    await expect(syncOfflineShell(true, worker)).resolves.toBeUndefined();
    await syncOfflineShell(true, worker);
    expect(worker.register).toHaveBeenCalledTimes(2);
    await syncOfflineShell(false, worker);
  });
});
