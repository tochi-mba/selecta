import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures } from '../flags';
import type { ImportOptions, ImportSummary, LapsedItem, MediaStore, StoredFolderHandle } from '../media';
import { cancelImportSession, clearImportMarker, clearImportSession, importMarkerKey, readImportMarker } from './importSession';

const media = vi.hoisted(() => ({
  items: [] as LapsedItem[],
  folder: null as unknown,
  forgotten: [] as string[],
  remembered: [] as string[],
}));
vi.mock('../media', async (original) => ({
  ...(await original<typeof import('../media')>()),
  findLapsed: async () => media.items,
  dirPicker: () => ({ supported: false, reason: 'This browser has no folder picker.' }),
  directoryInput: () => ({ supported: false }),
  recallFolder: async () => media.folder,
  forgetFolder: async (workspaceId: string) => { media.forgotten.push(workspaceId); },
  rememberFolder: async (workspaceId: string) => { media.remembered.push(workspaceId); },
}));

const { applyImportEvent, ConnectMusic, summaryWords } = await import('./ConnectMusic');

const WS = 'ws';
const store = { degraded: false } as unknown as MediaStore;
const openStore = async () => store;
const SUMMARY: ImportSummary = { imported: 1, duplicates: 0, failed: 1, skipped: 0, cancelled: false, paused: false };

function controlledImport() {
  let finish: (summary: ImportSummary) => void = () => {};
  let options: ImportOptions | null = null;
  const importer = vi.fn((given: ImportOptions) => {
    options = given;
    return new Promise<ImportSummary>((resolve) => {
      finish = resolve;
      given.signal?.addEventListener('abort', () => resolve({ ...SUMMARY, imported: 0, failed: 0, cancelled: true }));
    });
  });
  return { importer, progress: (event: Parameters<NonNullable<ImportOptions['onProgress']>>[0]) => options!.onProgress?.(event), finish: (summary: ImportSummary) => finish(summary), options: () => options };
}

const pick = async (names: string[]) => {
  const input = document.querySelector<HTMLInputElement>('input[accept="audio/*"]')!;
  await userEvent.upload(input, names.map((name) => new File(['x'], name, { type: 'audio/mpeg' })));
};

const mount = (importer?: ReturnType<typeof controlledImport>['importer']) =>
  render(<ConnectMusic request={vi.fn()} workspaceId={WS} openStore={openStore} importer={importer} />);

afterEach(async () => {
  // the session is module-wide: settle and dismiss whatever a test left, and its marker
  cancelImportSession();
  await act(async () => { await new Promise((settled) => setTimeout(settled, 0)); });
  act(() => clearImportSession());
  clearImportMarker(WS);
  setAccountFeatures(null);
  media.items = []; media.folder = null; media.forgotten = []; media.remembered = [];
});

describe('Connect Music', () => {
  it('folds importer events into one row per file, replacing in-progress stages', () => {
    let rows = applyImportEvent([], { kind: 'file', name: 'a.mp3', stage: 'hashing' });
    rows = applyImportEvent(rows, { kind: 'file', name: 'a.mp3', stage: 'registering' });
    rows = applyImportEvent(rows, { kind: 'file', name: 'a.mp3', stage: 'done', songId: 3 });
    rows = applyImportEvent(rows, { kind: 'file', name: 'b.mp3', stage: 'failed', reason: 'Not audio' });
    expect(rows).toEqual([{ name: 'a.mp3', stage: 'done', duplicate: false }, { name: 'b.mp3', stage: 'failed', reason: 'Not audio' }]);
  });

  it('says what an import did, and that a cancel changed nothing else', () => {
    expect(summaryWords(SUMMARY)).toBe('1 song connected, 1 could not be read.');
    expect(summaryWords({ ...SUMMARY, cancelled: true })).toMatch(/^Stopped\. .*Nothing else changed\.$/);
    expect(summaryWords({ ...SUMMARY, paused: true })).toMatch(/browser storage is full/);
  });

  it('shows the session’s progress against the counted total, every failure, then the summary', async () => {
    const run = controlledImport();
    mount(run.importer);
    await pick(['one.mp3', 'two.mp3']);
    await waitFor(() => expect(run.importer).toHaveBeenCalled());
    expect(run.options()?.request).toBeTypeOf('function');
    expect(screen.getByText(/0 of … files checked so far/)).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Files checked' })).not.toHaveAttribute('value');
    act(() => {
      run.progress({ kind: 'collected', total: 2, skipped: 0 });
      run.progress({ kind: 'file', name: 'one.mp3', stage: 'hashing' });
      run.progress({ kind: 'file', name: 'one.mp3', stage: 'done', songId: 1 });
    });
    expect(screen.getByText(/1 of 2 files checked so far/)).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Files checked' })).toHaveAttribute('value', '1');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    // pickers stay hidden while an import runs
    expect(screen.queryByText('Choose songs')).toBeNull();
    act(() => run.progress({ kind: 'file', name: 'two.mp3', stage: 'failed', reason: 'This file is not audio SelectaDJ can read.' }));
    expect(screen.getByText(/2 of 2 files checked so far/)).toBeVisible();
    await act(async () => run.finish(SUMMARY));
    expect(await screen.findByText('1 song connected, 1 could not be read.')).toBeVisible();
    expect(screen.getByText(/1 file could not be connected/)).toBeVisible();
    expect(screen.getByText(/This file is not audio SelectaDJ can read\./)).toBeVisible();
    // another folder or set of files can be added straight away
    expect(screen.getByText('Choose songs')).toBeVisible();
  });

  it('cancels mid-import through the session', async () => {
    const run = controlledImport();
    mount(run.importer);
    await pick(['one.mp3']);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(run.options()?.signal?.aborted).toBe(true);
    expect(await screen.findByText(/^Stopped\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(readImportMarker(WS)).toBeNull();
  });

  it('keeps importing after it unmounts while cloud.progressive_import is on', async () => {
    const run = controlledImport();
    const view = mount(run.importer);
    await pick(['one.mp3']);
    await waitFor(() => expect(run.importer).toHaveBeenCalled());
    view.unmount();
    expect(run.options()?.signal?.aborted).toBe(false);
  });

  it('stops the import when it unmounts with cloud.progressive_import off', async () => {
    setAccountFeatures({ 'cloud.progressive_import': false });
    const run = controlledImport();
    const view = mount(run.importer);
    await pick(['one.mp3']);
    await waitFor(() => expect(run.importer).toHaveBeenCalled());
    view.unmount();
    expect(run.options()?.signal?.aborted).toBe(true);
  });

  it('offers to carry on an interrupted folder import, after the browser allows it again', async () => {
    localStorage.setItem(importMarkerKey(WS), JSON.stringify({ version: 1, folder: 'Crates', startedAt: 1, total: 40, registered: 10 }));
    const requestPermission = vi.fn(async () => 'granted');
    const handle = { kind: 'directory', name: 'Crates', values: async function* () {}, requestPermission };
    media.folder = handle;
    const run = controlledImport();
    mount(run.importer);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('An import of Crates was interrupted. Anything already checked is in your library.');
    await userEvent.click(screen.getByRole('button', { name: 'Keep checking Crates' }));
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    await waitFor(() => expect(run.importer).toHaveBeenCalled());
    expect(run.options()?.source).toBe(handle);
    expect(await screen.findByText(/files checked so far/)).toBeVisible();
  });

  it('asks for the folder again when the browser refuses it', async () => {
    localStorage.setItem(importMarkerKey(WS), JSON.stringify({ version: 1, folder: 'Crates', startedAt: 1, total: null, registered: 3 }));
    media.folder = { kind: 'directory', name: 'Crates', values: async function* () {}, requestPermission: async () => 'denied' } satisfies StoredFolderHandle;
    const run = controlledImport();
    mount(run.importer);
    await userEvent.click(await screen.findByRole('button', { name: 'Keep checking Crates' }));
    expect(await screen.findByText('The browser did not allow it. Choose the folder again.')).toBeVisible();
    expect(run.importer).not.toHaveBeenCalled();
    expect(screen.getByText('Choose songs')).toBeVisible();
  });

  it('forgets an interrupted import on request', async () => {
    localStorage.setItem(importMarkerKey(WS), JSON.stringify({ version: 1, folder: 'Crates', startedAt: 1, total: 4, registered: 2 }));
    media.folder = { kind: 'directory', name: 'Crates', values: async function* () {} };
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Forget this' }));
    expect(media.forgotten).toEqual([WS]);
    expect(readImportMarker(WS)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('without a remembered folder, says picking the same music again duplicates nothing', async () => {
    localStorage.setItem(importMarkerKey(WS), JSON.stringify({ version: 1, folder: null, startedAt: 1, total: 4, registered: 2 }));
    mount();
    expect(await screen.findByRole('note')).toHaveTextContent('An import stopped part way last time. Anything already checked is in your library. Choose the same folder or files again and SelectaDJ will recognise them; nothing is duplicated.');
    expect(screen.getByText('Choose songs')).toBeVisible();
  });

  it('shows no resume offer with cloud.progressive_import off', async () => {
    setAccountFeatures({ 'cloud.progressive_import': false });
    localStorage.setItem(importMarkerKey(WS), JSON.stringify({ version: 1, folder: null, startedAt: 1, total: 4, registered: 2 }));
    mount();
    expect(await screen.findByText('Choose songs')).toBeVisible();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('lists songs whose permission lapsed and allows each again from a press', async () => {
    const regrant = vi.fn(async () => ({ status: 'recovered' as const }));
    media.items = [
      { songId: 4, title: 'Late night', why: 'permission', regrant },
      { songId: 5, title: 'Gone', why: 'missing', regrant: async () => ({ status: 'missing' as const }) },
    ];
    mount();
    expect(await screen.findByText('Late night')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(regrant).toHaveBeenCalled();
    expect(await screen.findByText(/Allowed again/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Look again' }));
    expect(await screen.findByText(/no longer where it was/)).toBeVisible();
  });

  it('explains a browser without a folder picker instead of showing a dead button', async () => {
    mount();
    expect(await screen.findByText('This browser has no folder picker.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Choose a folder' })).toBeNull();
    expect(screen.getByText('Choose songs')).toBeVisible();
  });
});
