import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { MediaStore, runImport, saveWatchedFolder, type DirectoryHandleLike, type WatchedFolder } from '../media';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from '../media/testFixtures';
import { bindWatch, loadFolders } from './folderWatch';
import { clearImportSession } from './importSession';
import { MusicFolders, rowWords } from './MusicFolders';

// Your music folders (cloud.music_folders): each folder's state in words, Allow from the press,
// Check now, the Stop watching dialog with its two honest choices, and nothing at all when off.

const WS = 'ws-folders';
let unbind: (() => void) | null = null;
let store: MediaStore;

const record = (id: string, handle: DirectoryHandleLike, over: Partial<WatchedFolder> = {}): WatchedFolder => ({
  kind: 'folder', id, workspaceId: WS, handle, name: handle.name, addedAt: Number(id.slice(1)), checkedAt: Date.now() - 5 * 60_000,
  songs: 214, lastNew: 0, missing: 0, state: 'watching', ...over,
});

async function show(extras = {}) {
  const { request, calls } = captureRequest();
  const importer = (async () => ({ imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false })) as unknown as typeof runImport;
  unbind = bindWatch({ request, openStore: async () => store, workspaceId: WS, importer }, { extras, firstCheck: false });
  await act(async () => { await loadFolders(WS); });
  const added = vi.fn();
  render(<MusicFolders workspaceId={WS} variant="full" onAddFolder={added} onChooseSongs={() => undefined} />);
  return { calls, added };
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  setFlags({ 'cloud.music_folders': true, 'cloud.resilient_import': false, 'cloud.content_cache': false });
  store = await MediaStore.open(WS);
});

afterEach(() => {
  act(() => { unbind?.(); });
  unbind = null;
  clearImportSession();
  setFlags(null);
  vi.unstubAllGlobals();
});

describe('Your music folders', () => {
  it('lists each folder with its songs, when it was checked and its state in words', async () => {
    let permission = 'prompt';
    const asks = Object.assign(fakeDirectory('Downloads', []), {
      queryPermission: async () => permission,
      requestPermission: vi.fn(async () => { permission = 'granted'; return permission; }),
    });
    await saveWatchedFolder(record('f1', fakeDirectory('Music', [])));
    await saveWatchedFolder(record('f2', asks, { songs: 12 }));
    await saveWatchedFolder(record('f3', fakeDirectory('Old drive', []), { state: 'missing', songs: 40 }));
    const told = vi.fn();
    await show({ onAvailabilityChanged: told });
    const list = screen.getByRole('region', { name: 'Your music folders' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Music');
    expect(rows[0]).toHaveTextContent('214 songs');
    expect(rows[0]).toHaveTextContent('Checked 5 minutes ago');
    expect(rows[0]).toHaveTextContent('Watching');
    expect(rows[1]).toHaveTextContent('Needs your permission');
    expect(rows[2]).toHaveTextContent('Not found');
    expect(within(rows[2]).getByRole('button', { name: 'Choose it again' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Add a folder/ })).toBeInTheDocument();

    // Allow asks the browser from the press, restores the folder, and tells the shell
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(asks.requestPermission).toHaveBeenCalled());
    await waitFor(() => expect(told).toHaveBeenCalled());
    await waitFor(() => expect(within(list).getAllByRole('listitem')[1]).not.toHaveTextContent('Needs your permission'));
  });

  it('Check now looks at the folder again and says when', async () => {
    await saveWatchedFolder(record('f1', fakeDirectory('Music', [fakeHandle(bytesFile('x', 'a.mp3'))]), { checkedAt: Date.now() - 3 * 3600_000 }));
    await show();
    const row = screen.getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('Checked 3 hours ago');
    fireEvent.click(within(row).getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Checked just now'));
  });

  it('Stop watching asks with two honest choices and takes out only that folder\'s own songs', async () => {
    await saveWatchedFolder(record('f1', fakeDirectory('Music', [])));
    await store.put({ songId: 1, identity: { content_sha256: 'hash-1', title: 'Only here', artist: 'A' }, ref: { kind: 'repick', name: '1.mp3', size: 1 }, importedAt: 1, sources: [{ folderId: 'f1', path: '1.mp3', size: 1, modified: 1 }] });
    const { calls } = await show();
    fireEvent.click(screen.getByRole('button', { name: 'More for Music' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Stop watching/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Stop watching Music?' });
    expect(within(dialog).getByRole('radio', { name: /Keep its songs in my library/ })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /Remove its 1 song from my library too/ })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('radio', { name: /Remove its 1 song/ }));
    expect(dialog).toHaveTextContent('You can undo this for a few seconds afterwards.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop watching' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/local-media/songs/1']));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('says how a check is going without words that name a mode', () => {
    const words = rowWords({ id: 'x', name: 'Music', addedAt: 1, checkedAt: null, songs: null, lastNew: 0, missing: 0, state: 'visit', handle: null, kept: false });
    expect(words).toContain('choose it again next time');
    expect(words.toLowerCase()).not.toMatch(/local-first|browser-first|hosted/);
  });

  it('draws nothing at all with the flag off', async () => {
    setFlags({ 'cloud.music_folders': false });
    const { container } = render(<MusicFolders workspaceId={WS} variant="compact" onAddFolder={() => undefined} onChooseSongs={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
