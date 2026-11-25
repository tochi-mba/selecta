import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import type { ImportEvent, ImportSummary } from '../media';
import {
  cancelImportSession,
  clearImportMarker,
  clearImportSession,
  IDLE_IMPORT,
  importMarkerKey,
  importSnapshot,
  readImportMarker,
  startImportSession,
  subscribeImport,
} from './importSession';
import type { ImportRunner } from './importSession';

const summaryOf = (over: Partial<ImportSummary> = {}): ImportSummary => ({ imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false, ...over });

/** A runner the test drives by hand: emit events, then resolve or reject. */
function manualRunner() {
  let emit: (event: ImportEvent) => void = () => {};
  let signal: AbortSignal | null = null;
  let resolve: (summary: ImportSummary) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const run: ImportRunner = (_source, onProgress, abort) => {
    emit = onProgress;
    signal = abort;
    return new Promise<ImportSummary>((ok, fail) => { resolve = ok; reject = fail; });
  };
  return {
    run,
    emit: (event: ImportEvent) => emit(event),
    signal: () => signal,
    resolve: (summary: ImportSummary) => resolve(summary),
    reject: (error: unknown) => reject(error),
  };
}

const done = (name: string, songId: number, duplicateOf?: number): ImportEvent =>
  duplicateOf === undefined ? { kind: 'file', name, stage: 'done', songId } : { kind: 'file', name, stage: 'done', songId, duplicateOf };

/** A Storage stand-in whose contents the test can read and whose writes can be made to throw. */
function fakeStorage(options: { throws?: boolean } = {}) {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => { if (options.throws) throw new Error('blocked'); return items.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (options.throws) throw new Error('blocked'); items.set(key, value); },
    removeItem: (key: string) => { if (options.throws) throw new Error('blocked'); items.delete(key); },
    clear: () => items.clear(),
  };
  return { storage, items };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  // Leave no session from a previous test running.
  cancelImportSession();
});

// These describe the session as it always was: with cloud.resilient_import off the run starts at
// once, in the same tick. With it on, the run first claims the import across tabs; that path is
// below and in importTabs.test.ts / importResume.test.ts.
describe('importSession with cloud.resilient_import off', () => {
  beforeEach(() => { setFlags({ 'cloud.resilient_import': false }); });


afterEach(async () => {
  await flush();
  clearImportSession();
});

describe('importSession', () => {
  it('folds runner events into one snapshot, with registered = imported + duplicates', async () => {
    const runner = manualRunner();
    const result = startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1', folder: 'Music' });
    expect(importSnapshot()).toMatchObject({ phase: 'running', folder: 'Music', total: null });
    runner.emit({ kind: 'collected', total: 4, skipped: 2 });
    runner.emit({ kind: 'file', name: 'a.mp3', stage: 'hashing' });
    expect(importSnapshot().current).toBe('a.mp3');
    runner.emit(done('a.mp3', 1));
    runner.emit(done('b.mp3', 2, 1));
    runner.emit({ kind: 'file', name: 'c.mp3', stage: 'failed', reason: 'unreadable' });
    runner.emit({ kind: 'batch', registered: 2 });
    expect(importSnapshot()).toMatchObject({ total: 4, skipped: 2, registered: 2, imported: 1, duplicates: 1, batches: 1 });
    expect(importSnapshot().failures).toEqual([{ name: 'c.mp3', reason: 'unreadable' }]);
    const summary = summaryOf({ imported: 1, duplicates: 1, failed: 1, skipped: 2 });
    runner.resolve(summary);
    await expect(result).resolves.toEqual(summary);
    expect(importSnapshot()).toMatchObject({ phase: 'finished', current: null, summary });
  });

  it('keeps running and folding with nothing subscribed, and tells late subscribers', async () => {
    const runner = manualRunner();
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    const seen = vi.fn();
    const off = subscribeImport(seen);
    off();
    runner.emit(done('a.mp3', 1));
    runner.emit(done('b.mp3', 2));
    expect(seen).not.toHaveBeenCalled();
    expect(importSnapshot().registered).toBe(2);
    const late = vi.fn();
    const offLate = subscribeImport(late);
    runner.emit(done('c.mp3', 3));
    expect(late).toHaveBeenCalled();
    offLate();
    runner.resolve(summaryOf({ imported: 3 }));
    await flush();
    expect(importSnapshot()).toMatchObject({ phase: 'finished', imported: 3 });
  });

  it('cancel aborts the run, keeps the partial truth and clears the marker', async () => {
    const { storage, items } = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const runner = manualRunner();
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    runner.emit(done('a.mp3', 1));
    runner.emit({ kind: 'batch', registered: 1 });
    expect(items.has(importMarkerKey('ws-1'))).toBe(true);
    cancelImportSession();
    expect(runner.signal()?.aborted).toBe(true);
    expect(items.has(importMarkerKey('ws-1'))).toBe(false);
    // A batch confirmed after the cancel never resurrects the marker.
    runner.emit({ kind: 'batch', registered: 0 });
    expect(items.has(importMarkerKey('ws-1'))).toBe(false);
    runner.resolve(summaryOf({ imported: 1, cancelled: true }));
    await flush();
    expect(importSnapshot()).toMatchObject({ phase: 'finished', registered: 1, imported: 1, summary: { cancelled: true } });
    expect(items.has(importMarkerKey('ws-1'))).toBe(false);
  });

  it('pauses on storage_full and keeps the marker so the member can carry on', async () => {
    const { storage } = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const runner = manualRunner();
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1', folder: 'Crates' });
    runner.emit({ kind: 'collected', total: 10, skipped: 0 });
    runner.emit(done('a.mp3', 1));
    runner.emit({ kind: 'batch', registered: 1 });
    runner.emit({ kind: 'paused', paused: 'storage_full' });
    expect(importSnapshot().phase).toBe('paused');
    runner.resolve(summaryOf({ imported: 1, paused: true }));
    await flush();
    expect(importSnapshot()).toMatchObject({ phase: 'paused', summary: { paused: true } });
    expect(readImportMarker('ws-1')).toMatchObject({ version: 1, folder: 'Crates', total: 10, registered: 1 });
  });

  it('a second start cancels the first and ignores its late events', async () => {
    const first = manualRunner();
    const second = manualRunner();
    startImportSession({ source: [], run: first.run, workspaceId: 'ws-1', folder: 'One' });
    first.emit(done('a.mp3', 1));
    startImportSession({ source: [], run: second.run, workspaceId: 'ws-1', folder: 'Two' });
    expect(first.signal()?.aborted).toBe(true);
    expect(second.signal()?.aborted).toBe(false);
    expect(importSnapshot()).toMatchObject({ phase: 'running', folder: 'Two', registered: 0 });
    first.emit(done('late.mp3', 9));
    first.resolve(summaryOf({ imported: 2, cancelled: true }));
    await flush();
    expect(importSnapshot()).toMatchObject({ phase: 'running', folder: 'Two', registered: 0 });
    second.resolve(summaryOf());
    await flush();
    expect(importSnapshot().phase).toBe('finished');
  });

  it('a rejected run fails with an error and keeps the marker', async () => {
    const { storage } = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const runner = manualRunner();
    const result = startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    runner.reject(new Error('Cloud did not answer.'));
    await expect(result).rejects.toThrow('Cloud did not answer.');
    expect(importSnapshot()).toMatchObject({ phase: 'failed', error: 'Cloud did not answer.' });
    expect(readImportMarker('ws-1')).not.toBeNull();
  });

  it('writes the marker at start, updates it per batch, clears it on a clean finish', async () => {
    const { storage, items } = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const runner = manualRunner();
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-9', folder: 'Music' });
    const started = readImportMarker('ws-9');
    expect(started).toMatchObject({ version: 1, folder: 'Music', total: null, registered: 0 });
    expect(typeof started?.startedAt).toBe('number');
    runner.emit({ kind: 'collected', total: 3, skipped: 1 });
    runner.emit(done('a.mp3', 1));
    runner.emit(done('b.mp3', 2));
    runner.emit({ kind: 'batch', registered: 2 });
    expect(readImportMarker('ws-9')).toMatchObject({ total: 3, registered: 2, startedAt: started?.startedAt });
    runner.resolve(summaryOf({ imported: 2 }));
    await flush();
    expect(items.has(importMarkerKey('ws-9'))).toBe(false);
  });

  it('reads only well-formed markers and survives storage that throws', () => {
    const { storage, items } = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    items.set(importMarkerKey('ws-1'), 'not json');
    expect(readImportMarker('ws-1')).toBeNull();
    items.set(importMarkerKey('ws-1'), JSON.stringify({ version: 2, startedAt: 1, registered: 0 }));
    expect(readImportMarker('ws-1')).toBeNull();
    clearImportMarker('ws-1');
    expect(items.size).toBe(0);
    vi.stubGlobal('localStorage', fakeStorage({ throws: true }).storage);
    expect(readImportMarker('ws-1')).toBeNull();
    expect(() => clearImportMarker('ws-1')).not.toThrow();
    const runner = manualRunner();
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    runner.emit({ kind: 'batch', registered: 0 });
    expect(importSnapshot().phase).toBe('running');
    runner.resolve(summaryOf());
  });

  it('clears only from terminal phases', async () => {
    const runner = manualRunner();
    clearImportSession();
    expect(importSnapshot()).toBe(IDLE_IMPORT);
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    clearImportSession();
    expect(importSnapshot().phase).toBe('running');
    // Paused by the event but not yet settled: still not clearable.
    runner.emit({ kind: 'paused', paused: 'storage_full' });
    clearImportSession();
    expect(importSnapshot().phase).toBe('paused');
    runner.resolve(summaryOf({ paused: true }));
    await flush();
    clearImportSession();
    expect(importSnapshot()).toBe(IDLE_IMPORT);
  });
});
});

describe('importSession with cloud.resilient_import on', () => {
  it('writes the marker once the run holds the import, with its kind, id and checked count', async () => {
    const { storage } = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const runner = manualRunner();
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-r1', folder: 'Music', kind: 'folder' });
    await vi.waitFor(() => expect(runner.signal()).not.toBeNull());
    expect(readImportMarker('ws-r1')).toMatchObject({ version: 1, folder: 'Music', kind: 'folder', importId: expect.any(String), checked: 0 });
    runner.emit({ kind: 'collected', total: 30, skipped: 0 });
    for (let at = 0; at < 25; at += 1) runner.emit({ kind: 'checked', name: `${at}.mp3`, resumed: at < 5 });
    expect(importSnapshot()).toMatchObject({ checked: 25, resumed: 5 });
    expect(readImportMarker('ws-r1')).toMatchObject({ checked: 25 });
    runner.emit({ kind: 'waiting', wait: { why: 'offline', retryAt: null } });
    expect(importSnapshot().waiting).toEqual({ why: 'offline', retryAt: null });
    runner.resolve(summaryOf({ imported: 30 }));
    await flush();
    expect(readImportMarker('ws-r1')).toBeNull();
  });

  it('a resumed import keeps its id and start time', async () => {
    const runner = manualRunner();
    const resume = { version: 1 as const, folder: 'Music', startedAt: 42, total: 9, registered: 3, kind: 'folder' as const, importId: 'imp-9', checked: 4 };
    startImportSession({ source: [], run: runner.run, workspaceId: 'ws-r2', kind: 'folder', resume });
    await vi.waitFor(() => expect(runner.signal()).not.toBeNull());
    expect(readImportMarker('ws-r2')).toMatchObject({ importId: 'imp-9', startedAt: 42 });
    runner.resolve(summaryOf());
  });

  it('a rejected run says what is kept in plain words and keeps the marker', async () => {
    const runner = manualRunner();
    const result = startImportSession({ source: [], run: runner.run, workspaceId: 'ws-r3' });
    await vi.waitFor(() => expect(runner.signal()).not.toBeNull());
    runner.reject(new TypeError('Failed to fetch'));
    await expect(result).rejects.toThrow('Failed to fetch');
    expect(importSnapshot().phase).toBe('failed');
    expect(importSnapshot().error).toMatch(/Everything already checked is kept/);
    expect(importSnapshot().error).not.toMatch(/failed to fetch/i);
    expect(readImportMarker('ws-r3')).not.toBeNull();
  });

  // T-20261125-3985 part 3: a reload asks first only when something would really be lost
  it('a reload asks first while picked files are read, never for a folder, which carries on by itself', async () => {
    const asks = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const picked = manualRunner();
    startImportSession({ source: [], run: picked.run, workspaceId: 'ws-u1', kind: 'files' });
    await vi.waitFor(() => expect(picked.signal()).not.toBeNull());
    expect(asks()).toBe(true);
    picked.emit({ kind: 'read' });
    expect(asks()).toBe(false); // every file read: the rest carries on from the journal
    picked.resolve(summaryOf());
    await flush();

    const folder = manualRunner();
    startImportSession({ source: [], run: folder.run, workspaceId: 'ws-u2', folder: 'Music', kind: 'folder' });
    await vi.waitFor(() => expect(folder.signal()).not.toBeNull());
    expect(asks()).toBe(false);
    folder.resolve(summaryOf());
    await flush();
    expect(asks()).toBe(false);
  });
});
