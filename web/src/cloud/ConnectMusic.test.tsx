import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImportOptions, ImportSummary, LapsedItem, MediaStore } from '../media';

const lapsed = vi.hoisted(() => ({ items: [] as LapsedItem[] }));
vi.mock('../media', async (original) => ({
  ...(await original<typeof import('../media')>()),
  findLapsed: async () => lapsed.items,
  dirPicker: () => ({ supported: false, reason: 'This browser has no folder picker.' }),
  directoryInput: () => ({ supported: false }),
}));

const { applyImportEvent, ConnectMusic, summaryWords } = await import('./ConnectMusic');

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

  it('shows progress per file, every failure with its reason, then the summary', async () => {
    lapsed.items = [];
    const run = controlledImport();
    const imported = vi.fn();
    render(<ConnectMusic request={vi.fn()} workspaceId="ws" openStore={openStore} onImported={imported} importer={run.importer} />);
    await pick(['one.mp3', 'two.mp3']);
    await waitFor(() => expect(run.importer).toHaveBeenCalled());
    expect(run.options()?.request).toBeTypeOf('function');
    act(() => {
      run.progress({ kind: 'file', name: 'one.mp3', stage: 'hashing' });
      run.progress({ kind: 'file', name: 'two.mp3', stage: 'hashing' });
      run.progress({ kind: 'file', name: 'one.mp3', stage: 'done', songId: 1 });
    });
    expect(screen.getByText(/1 of 2 files checked so far/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    act(() => run.progress({ kind: 'file', name: 'two.mp3', stage: 'failed', reason: 'This file is not audio SelectaDJ can read.' }));
    await act(async () => run.finish(SUMMARY));
    expect(await screen.findByText('1 song connected, 1 could not be read.')).toBeVisible();
    expect(screen.getByText(/1 file could not be connected/)).toBeVisible();
    expect(screen.getByText(/This file is not audio SelectaDJ can read\./)).toBeVisible();
    expect(imported).toHaveBeenCalledTimes(1);
  });

  it('cancels mid-import through the importer’s own signal', async () => {
    lapsed.items = [];
    const run = controlledImport();
    render(<ConnectMusic request={vi.fn()} workspaceId="ws" openStore={openStore} onImported={vi.fn()} importer={run.importer} />);
    await pick(['one.mp3']);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(run.options()?.signal?.aborted).toBe(true);
    expect(await screen.findByText(/^Stopped\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('lists songs whose permission lapsed and allows each again from a press', async () => {
    const regrant = vi.fn(async () => ({ status: 'recovered' as const }));
    lapsed.items = [
      { songId: 4, title: 'Late night', why: 'permission', regrant },
      { songId: 5, title: 'Gone', why: 'missing', regrant: async () => ({ status: 'missing' as const }) },
    ];
    const imported = vi.fn();
    render(<ConnectMusic request={vi.fn()} workspaceId="ws" openStore={openStore} onImported={imported} />);
    expect(await screen.findByText('Late night')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(regrant).toHaveBeenCalled();
    expect(await screen.findByText(/Allowed again/)).toBeVisible();
    expect(imported).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Look again' }));
    expect(await screen.findByText(/no longer where it was/)).toBeVisible();
  });

  it('explains a browser without a folder picker instead of showing a dead button', async () => {
    lapsed.items = [];
    render(<ConnectMusic request={vi.fn()} workspaceId="ws" openStore={openStore} onImported={vi.fn()} />);
    expect(await screen.findByText('This browser has no folder picker.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Choose a folder' })).toBeNull();
    expect(screen.getByText('Choose songs')).toBeVisible();
  });
});
