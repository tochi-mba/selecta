import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { MediaStore, rememberFolder, type ImportSummary, type StoredFolderHandle } from '../media';
import type { ImportOptions, runImport } from '../media/importer';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { ImportJournal } from '../media/importJournal';
import { allowAndCarryOn, importRunnerFor, useImportCarryOn, useResumeOffer, type ResumeOffer } from './importResume';
import {
  cancelImportSession, clearImportSession, endImportSession, IMPORT_SUSPENDED, importMarkerKey, importProblemWords,
  importSnapshot, keptImportWaiting, readImportMarker, startImportSession, type ImportMarker,
} from './importSession';

// Carrying an interrupted import on (cloud.resilient_import): the offer and its count come from
// the journal, a granted folder carries on by itself, a lapsed one needs one press, and a shell
// that goes away (a sign-in that ended) pauses the import instead of deleting it.

const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({ imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false, ...over });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const marker = (over: Partial<ImportMarker> = {}): ImportMarker => ({ version: 1, folder: 'Chill Hits', startedAt: 100, total: 1280, registered: 300, kind: 'folder', checked: 300, importId: 'imp-7', ...over });
const writeMarker = (workspaceId: string, value: ImportMarker) => localStorage.setItem(importMarkerKey(workspaceId), JSON.stringify(value));

function folder(permission: string): StoredFolderHandle {
  const handle: StoredFolderHandle = {
    kind: 'directory', name: 'Chill Hits',
    values: () => (async function* () { /* empty */ })(),
    queryPermission: async () => permission,
    requestPermission: async () => { permission = 'granted'; return permission; },
  };
  return handle;
}

async function journalWith(workspaceId: string, count: number) {
  const journal = await ImportJournal.open(workspaceId);
  await journal.put(Array.from({ length: count }, (_unused, at) => ({
    key: `f${at}`, importId: 'imp-7', name: `f${at}.mp3`, state: 'fingerprinted' as const, at: 1,
    entry: { content_sha256: `sha${at}`, title: 'T', artist: 'A' },
  })));
  journal.close();
}

function parts(workspaceId: string, importer?: typeof runImport) {
  return { request: vi.fn() as never, openStore: () => MediaStore.open(workspaceId), workspaceId, importer };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
});

afterEach(async () => {
  cancelImportSession();
  await flush();
  clearImportSession();
});

describe('the carry-on offer', () => {
  it('plain picked files: asks to choose them again, counting what the journal already checked', async () => {
    writeMarker('ws-1', marker({ kind: 'files', checked: 3, registered: 2 }));
    await journalWith('ws-1', 412);
    const given = parts('ws-1');
    const { result } = renderHook(() => { useImportCarryOn(given); return useResumeOffer('ws-1'); });
    await vi.waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toMatchObject({ kind: 'repick', folder: 'Chill Hits' });
    expect(result.current!.marker.checked).toBe(412);
  });

  it('another tab is importing: this tab follows it and offers nothing to carry on or forget', async () => {
    writeMarker('ws-1', marker({ kind: 'files', checked: 3, registered: 2 }));
    // a Web Lock held by the other tab, as navigator.locks.query reports it
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        query: async () => ({ held: [{ name: 'selecta-import-ws-1' }] }),
        request: () => new Promise(() => undefined),
      },
    });
    try {
      const given = parts('ws-1');
      const { result } = renderHook(() => { useImportCarryOn(given); return useResumeOffer('ws-1'); });
      await vi.waitFor(() => expect(importSnapshot()).toMatchObject({ phase: 'running', elsewhere: true }));
      expect(result.current).toBeNull();
      // the other tab's record is untouched
      expect(readImportMarker('ws-1')).not.toBeNull();
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('a remembered folder with permission granted carries on by itself under the same import id', async () => {
    writeMarker('ws-2', marker());
    await rememberFolder('ws-2', folder('granted'));
    const seen: ImportOptions[] = [];
    const importer = vi.fn(async (options: ImportOptions) => { seen.push(options); return summary(); }) as unknown as typeof runImport;
    const given = parts('ws-2', importer);
    const { result } = renderHook(() => { useImportCarryOn(given); return useResumeOffer('ws-2'); });
    await vi.waitFor(() => expect(importer).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(seen[0].importId).toBe('imp-7');
    expect(seen[0].journal).toBeDefined();
    expect(seen[0].retry).toBeDefined();
  });

  it('a lapsed folder permission offers one Allow press, which carries on', async () => {
    writeMarker('ws-3', marker());
    await rememberFolder('ws-3', folder('prompt'));
    const importer = vi.fn(async () => summary()) as unknown as typeof runImport;
    const given = parts('ws-3', importer);
    const { result } = renderHook(() => { useImportCarryOn(given); return useResumeOffer('ws-3'); });
    await vi.waitFor(() => expect(result.current?.kind).toBe('allow'));
    expect(importer).not.toHaveBeenCalled();
    let allowed = false;
    await act(async () => { allowed = await allowAndCarryOn(result.current as ResumeOffer & { kind: 'allow' }); });
    expect(allowed).toBe(true);
    await vi.waitFor(() => expect(importer).toHaveBeenCalled());
  });

  it('no interrupted import, or the flag off: no offer', async () => {
    const given = parts('ws-4');
    const { result } = renderHook(() => { useImportCarryOn(given); return useResumeOffer('ws-4'); });
    await flush();
    expect(result.current).toBeNull();

    setFlags({ 'cloud.resilient_import': false });
    writeMarker('ws-5', marker({ kind: 'files' }));
    const off = parts('ws-5');
    const second = renderHook(() => { useImportCarryOn(off); return useResumeOffer('ws-5'); });
    await flush();
    expect(second.result.current).toBeNull();
  });
});

describe('importRunnerFor', () => {
  it('clears the journal once an import really finished', async () => {
    await journalWith('ws-6', 2);
    const run = importRunnerFor(parts('ws-6', (async () => summary({ imported: 2 })) as unknown as typeof runImport));
    await run([], () => undefined, new AbortController().signal);
    expect((await ImportJournal.open('ws-6')).size).toBe(0);
  });

  it('keeps the journal when the import was put aside for a sign-in, or paused', async () => {
    await journalWith('ws-7', 2);
    const controller = new AbortController();
    const run = importRunnerFor(parts('ws-7', (async () => { controller.abort(IMPORT_SUSPENDED); return summary({ cancelled: true }); }) as unknown as typeof runImport));
    await run([], () => undefined, controller.signal);
    expect((await ImportJournal.open('ws-7')).size).toBe(2);

    const paused = importRunnerFor(parts('ws-7', (async () => summary({ paused: true })) as unknown as typeof runImport));
    await paused([], () => undefined, new AbortController().signal);
    expect((await ImportJournal.open('ws-7')).size).toBe(2);
  });

  it('with the flag off runs the import exactly as before, with no journal', async () => {
    setFlags({ 'cloud.resilient_import': false });
    const importer = vi.fn(async () => summary()) as unknown as typeof runImport;
    await importRunnerFor(parts('ws-8', importer))([], () => undefined, new AbortController().signal);
    expect((importer as unknown as { mock: { calls: ImportOptions[][] } }).mock.calls[0][0].journal).toBeUndefined();
  });
});

describe('the shell going away', () => {
  it('a sign-in that ended pauses the import and keeps its record; Cancel alone deletes it', async () => {
    let stopped: AbortSignal | null = null;
    void startImportSession({
      source: [], workspaceId: 'ws-9', folder: 'Chill Hits', kind: 'folder',
      run: (_source, _progress, signal) => { stopped = signal; return new Promise((resolve) => signal.addEventListener('abort', () => resolve(summary({ cancelled: true })))); },
    });
    await vi.waitFor(() => expect(stopped).not.toBeNull());
    endImportSession();
    expect(stopped!.aborted).toBe(true);
    expect(stopped!.reason).toBe(IMPORT_SUSPENDED);
    await flush();
    expect(readImportMarker('ws-9')).toMatchObject({ kept: true, folder: 'Chill Hits' });
    expect(keptImportWaiting()).toBe(true);
    expect(importSnapshot().phase).toBe('idle');

    void startImportSession({
      source: [], workspaceId: 'ws-9', kind: 'folder', resume: readImportMarker('ws-9'),
      run: (_source, _progress, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(summary({ cancelled: true })))),
    });
    await flush();
    cancelImportSession();
    await flush();
    expect(readImportMarker('ws-9')).toBeNull();
  });

  it('with the flag off the shell going away cancels, as it always did', async () => {
    setFlags({ 'cloud.resilient_import': false });
    void startImportSession({ source: [], workspaceId: 'ws-10', run: (_source, _progress, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(summary({ cancelled: true })))) });
    await flush();
    endImportSession();
    await flush();
    expect(readImportMarker('ws-10')).toBeNull();
    expect(keptImportWaiting()).toBe(false);
  });

  it('a stopped import is said in plain words, never a raw error', () => {
    expect(importProblemWords({ status: 401 })).toBe('Sign in again to carry on. Your import is kept.');
    expect(importProblemWords(new TypeError('Failed to fetch'))).toMatch(/Everything already checked is kept/);
    expect(importProblemWords({ status: 422 })).toMatch(/Everything already checked is kept/);
    expect(importProblemWords({ status: 503 })).not.toMatch(/503|failed to fetch/i);
  });
});
