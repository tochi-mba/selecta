import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import type { ImportEvent, ImportSummary } from '../media';
import { ImportChip } from './ImportChip';
import { cancelImportSession, clearImportSession, IDLE_IMPORT, importSnapshot, startImportSession, type ImportRunner, type ImportSnapshot } from './importSession';
import { CancelImportButton, checkedWords, offerWords, progressWords } from './ImportStatus';
import { IMPORT_RETRY_NOW } from '../media/journalledImport';

// The words every import surface shares (cloud.resilient_import): real counts, one next step,
// and never a raw browser error or an em dash.

const live = (over: Partial<ImportSnapshot> = {}): ImportSnapshot => ({ ...IDLE_IMPORT, phase: 'running', total: 1280, checked: 412, ...over });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function manualRunner() {
  let emit: (event: ImportEvent) => void = () => {};
  let finish: (summary: ImportSummary) => void = () => {};
  const run: ImportRunner = (_source, onProgress, signal) => {
    emit = onProgress;
    return new Promise((resolve) => {
      finish = resolve;
      signal.addEventListener('abort', () => resolve({ imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: true, paused: false }));
    });
  };
  return { run, emit: (event: ImportEvent) => act(() => emit(event)), finish: (summary: ImportSummary) => finish(summary) };
}

afterEach(async () => {
  cancelImportSession();
  await flush();
  clearImportSession();
});

describe('import words', () => {
  it('count what was checked, with the total once known', () => {
    expect(checkedWords(live())).toBe('412 of 1,280 checked');
    expect(checkedWords(live({ total: null }))).toBe('412 checked');
  });

  it('say each wait with its counts and next step', () => {
    expect(progressWords(live({ waiting: { why: 'offline', retryAt: null } }))).toBe('Offline. 412 of 1,280 checked. Carries on when you’re back online.');
    expect(progressWords(live({ waiting: { why: 'server', retryAt: 1 } }), 8)).toBe('SelectaDJ’s service isn’t answering. Trying again in 8 s. 412 of 1,280 checked.');
    expect(progressWords(live({ waiting: { why: 'signin', retryAt: null } }))).toBe('Sign in again to carry on. Your import is kept. 412 of 1,280 checked.');
    expect(progressWords(live({ elsewhere: true }))).toBe('Another tab is importing. Progress shows here too: 412 of 1,280 checked.');
    expect(progressWords(live({ resumed: 400 }))).toBe('Carrying on your import: 412 of 1,280 checked.');
    expect(progressWords(live())).toBe('Checking your music: 412 of 1,280 checked.');
  });

  it('the carry-on offer says what was done and the one step', () => {
    const marker = { version: 1 as const, folder: 'Chill Hits', startedAt: 1, total: 1280, registered: 300, checked: 412, kind: 'folder' as const };
    const allow = offerWords({ kind: 'allow', folder: 'Chill Hits', handle: {} as never, marker });
    expect(allow).toContain('412 of 1,280 checked');
    expect(allow).toContain('Allow the folder again and SelectaDJ carries on.');
    const repick = offerWords({ kind: 'repick', folder: null, marker: { ...marker, kind: 'files' } });
    expect(repick).toContain('Choose the same songs again and SelectaDJ carries on from there.');
    const dash = String.fromCharCode(8212);
    for (const text of [allow, repick]) {
      expect(text).not.toMatch(/failed to fetch/i);
      expect(text.includes(dash)).toBe(false);
    }
  });
});

describe('ImportChip', () => {
  it('offline during an import: says it carries on, with real counts', async () => {
    const runner = manualRunner();
    void startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1', folder: 'Music', kind: 'folder' });
    await vi.waitFor(() => expect(importSnapshot().phase).toBe('running'));
    render(<ImportChip onView={() => undefined} workspaceId="ws-1" />);
    await flush();
    runner.emit({ kind: 'collected', total: 3, skipped: 0 });
    runner.emit({ kind: 'checked', name: 'a.mp3', resumed: false });
    runner.emit({ kind: 'checked', name: 'b.mp3', resumed: false });
    runner.emit({ kind: 'waiting', wait: { why: 'offline', retryAt: null } });
    expect(screen.getByText('Offline. 2 of 3 checked. Carries on when you’re back online.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try now' })).toBeNull();
  });

  it('the service not answering: counts down and offers Try now', async () => {
    const runner = manualRunner();
    void startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1', kind: 'files' });
    await vi.waitFor(() => expect(importSnapshot().phase).toBe('running'));
    render(<ImportChip onView={() => undefined} workspaceId="ws-1" />);
    await flush();
    runner.emit({ kind: 'collected', total: 10, skipped: 0 });
    runner.emit({ kind: 'waiting', wait: { why: 'server', retryAt: Date.now() + 8_000 } });
    expect(screen.getByText(/SelectaDJ’s service isn’t answering\. Trying again in [78] s\. 0 of 10 checked\./)).toBeInTheDocument();
    const nudged = vi.fn();
    window.addEventListener(IMPORT_RETRY_NOW, nudged);
    fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    expect(nudged).toHaveBeenCalled();
    window.removeEventListener(IMPORT_RETRY_NOW, nudged);
  });

  it('a stopped import shows plain words and Try again, never the raw error', async () => {
    const run: ImportRunner = async () => { throw new TypeError('Failed to fetch'); };
    await startImportSession({ source: [], run, workspaceId: 'ws-1', kind: 'files' }).catch(() => undefined);
    render(<ImportChip onView={() => undefined} workspaceId="ws-1" />);
    expect(screen.getByText(/Everything already checked is kept/)).toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('storage full: the pause says to free space', async () => {
    const run: ImportRunner = async () => ({ imported: 3, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: true });
    await startImportSession({ source: [], run, workspaceId: 'ws-1', kind: 'files' });
    render(<ImportChip onView={() => undefined} workspaceId="ws-1" />);
    expect(screen.getByText(/browser storage is full.*Free some space and it carries on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Free up space' })).toBeInTheDocument();
  });

  it('with the flag off it reads as it always did', async () => {
    setFlags({ 'cloud.resilient_import': false });
    const runner = manualRunner();
    void startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    render(<ImportChip onView={() => undefined} workspaceId="ws-1" />);
    runner.emit({ kind: 'collected', total: 4, skipped: 0 });
    // a running import is a title, its count and a meter (the chip's current drawing, flag on or off)
    expect(screen.getByText('Adding your music')).toBeInTheDocument();
    expect(screen.getAllByText('0 of 4 checked').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar', { name: 'Files checked' })).toHaveAttribute('aria-valuetext', '0 of 4 checked');
  });
});

describe('CancelImportButton', () => {
  it('asks first; only a confirmed stop cancels the import', async () => {
    const runner = manualRunner();
    void startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1', kind: 'files' });
    await vi.waitFor(() => expect(importSnapshot().phase).toBe('running'));
    render(<CancelImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Stop this import?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep importing' }));
    await flush();
    expect(importSnapshot().phase).toBe('running');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop the import' }));
    await vi.waitFor(() => expect(importSnapshot().phase).not.toBe('running'));
  });

  it('with the flag off cancels at once, as before', async () => {
    setFlags({ 'cloud.resilient_import': false });
    const runner = manualRunner();
    void startImportSession({ source: [], run: runner.run, workspaceId: 'ws-1' });
    render(<CancelImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(importSnapshot().phase).not.toBe('running'));
  });
});
