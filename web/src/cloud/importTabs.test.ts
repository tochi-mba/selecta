import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportSummary } from '../media';
import {
  cancelImportSession, clearImportSession, IDLE_IMPORT, importMarkerKey, importSnapshot, readImportMarker, startImportSession,
} from './importSession';
import type { ImportRunner } from './importSession';
import { askImportCancel, claimImport, followImport } from './importTabs';

// One import per workspace across tabs (cloud.resilient_import): a Web Lock makes one tab the
// importer; any other follows over a BroadcastChannel and never deletes the first one's record.

/** Channels that deliver to every other instance of the same name, on the next microtask. */
class FakeChannel {
  static open = new Map<string, Set<FakeChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    if (!FakeChannel.open.has(name)) FakeChannel.open.set(name, new Set());
    FakeChannel.open.get(name)!.add(this);
  }
  postMessage(data: unknown) {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError');
    for (const other of FakeChannel.open.get(this.name) ?? []) {
      if (other !== this) queueMicrotask(() => { if (!other.closed) other.onmessage?.({ data } as MessageEvent); });
    }
  }
  close() {
    this.closed = true;
    FakeChannel.open.get(this.name)?.delete(this);
  }
}

/** navigator.locks for one browser: exclusive locks, ifAvailable, and waiting with a signal. */
function fakeLocks() {
  const held = new Set<string>();
  const waiting = new Map<string, (() => void)[]>();
  const grant = async (name: string, callback: (lock: unknown) => unknown) => {
    held.add(name);
    try {
      return await callback({ name });
    } finally {
      held.delete(name);
      const next = waiting.get(name)?.shift();
      next?.();
    }
  };
  return {
    held,
    request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown) {
      if (!held.has(name)) return grant(name, callback);
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        const go = () => { resolve(grant(name, callback)); };
        const list = waiting.get(name) ?? [];
        list.push(go);
        waiting.set(name, list);
        options.signal?.addEventListener('abort', () => {
          waiting.set(name, (waiting.get(name) ?? []).filter((one) => one !== go));
          reject(new DOMException('stopped', 'AbortError'));
        });
      });
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };

let locks: ReturnType<typeof fakeLocks>;
beforeEach(() => {
  FakeChannel.open.clear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  locks = fakeLocks();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
});

afterEach(async () => {
  cancelImportSession();
  await flush();
  clearImportSession();
  delete (navigator as { locks?: unknown }).locks;
});

describe('importTabs', () => {
  it('one tab gets the claim; another learns that a tab is already importing', async () => {
    const first = await claimImport('ws-1');
    expect(first).not.toBeNull();
    expect(await claimImport('ws-1')).toBeNull();
    // other workspaces are their own
    expect(await claimImport('ws-2')).not.toBeNull();
    first!.release();
    await flush();
    expect(await claimImport('ws-1')).not.toBeNull();
  });

  it('a following tab gets live progress and hears when the importing tab lets go', async () => {
    const claim = (await claimImport('ws-1'))!;
    const seen: number[] = [];
    const freed = vi.fn();
    const stop = followImport('ws-1', (shared) => seen.push(shared.registered), freed);
    claim.share({ ...IDLE_IMPORT, phase: 'running', registered: 3 });
    await flush();
    expect(seen).toContain(3);
    claim.share({ ...IDLE_IMPORT, phase: 'finished', registered: 9 });
    await flush();
    expect(seen.at(-1)).toBe(9);
    claim.release();
    await flush();
    expect(freed).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a follower that joins late asks and gets the latest snapshot', async () => {
    const claim = (await claimImport('ws-1'))!;
    claim.share({ ...IDLE_IMPORT, phase: 'running', registered: 5 });
    const seen: number[] = [];
    const stop = followImport('ws-1', (shared) => seen.push(shared.registered), () => undefined);
    await flush();
    expect(seen).toContain(5);
    stop();
    claim.release();
  });

  it('Cancel in the following tab is passed to the importing tab', async () => {
    const claim = (await claimImport('ws-1'))!;
    const asked = vi.fn();
    claim.onCancelAsked(asked);
    askImportCancel('ws-1');
    await flush();
    expect(asked).toHaveBeenCalledTimes(1);
    claim.release();
  });

  it('without Web Locks or channels every tab acts alone, as before', async () => {
    delete (navigator as { locks?: unknown }).locks;
    vi.stubGlobal('BroadcastChannel', undefined);
    const claim = await claimImport('ws-1');
    expect(claim).not.toBeNull();
    expect(() => claim!.share(IDLE_IMPORT)).not.toThrow();
    expect(() => askImportCancel('ws-1')).not.toThrow();
    claim!.release();
  });
});

describe('a second tab with the import session', () => {
  it('follows the importing tab, never starts a second run, and never deletes the record', async () => {
    // another tab is importing for this workspace and wrote its record
    const other = (await claimImport('ws-1'))!;
    const record = { version: 1, folder: 'Music', startedAt: 1, total: 40, registered: 10, kind: 'folder', checked: 12, importId: 'imp-1' };
    localStorage.setItem(importMarkerKey('ws-1'), JSON.stringify(record));
    const run = vi.fn<ImportRunner>(async () => summary);
    await startImportSession({ source: [], run, workspaceId: 'ws-1', folder: 'Music', kind: 'folder' });
    expect(run).not.toHaveBeenCalled();
    expect(importSnapshot()).toMatchObject({ phase: 'running', elsewhere: true });

    other.share({ ...IDLE_IMPORT, phase: 'running', folder: 'Music', total: 40, registered: 20, checked: 25 });
    // shares are throttled to one each 250 ms
    await vi.waitFor(() => expect(importSnapshot().registered).toBe(20), { timeout: 1_000 });
    expect(importSnapshot()).toMatchObject({ elsewhere: true, registered: 20, checked: 25 });

    const asked = vi.fn();
    other.onCancelAsked(asked);
    cancelImportSession();
    await flush();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(readImportMarker('ws-1')).toMatchObject({ registered: 10, importId: 'imp-1' });
    other.release();
  });
});
