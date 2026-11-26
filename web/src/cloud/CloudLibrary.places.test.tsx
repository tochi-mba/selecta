import { fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaceCounts, Status } from '../api';
import { LibraryPlacesContext, type LibraryPlacesChrome } from '../views/LibraryPlaces';
import type { ViewProps } from '../views/shared';
import { CloudLibrary, remoteLineWords } from './CloudLibrary';
import { PLACES_NOTE_PREFIX, PLACES_NOTE_WORDS } from './PlacesNote';

// library.places: the Library's lead says where songs are kept in one line, Add music says where
// each way keeps songs, and the choose-your-folder banners count songs kept on devices only.

vi.mock('./ConnectMusic', () => ({
  ConnectMusic: forwardRef<unknown, { variant: string }>(function Connect({ variant }, _ref) { return <div data-testid={`connect-${variant}`} />; }),
  summaryWords: () => '',
}));
vi.mock('./MusicFolders', () => ({ MusicFolders: () => null }));
vi.mock('./importSession', () => ({ useImportShellView: () => ({ phase: 'idle', summary: null }) }));
vi.mock('../views/Library', () => ({
  Library: ({ lead, browser }: { lead: ReactNode; browser: { action: ReactNode } }) => <div>{browser.action}{lead}</div>,
}));

const PLACES: PlaceCounts = { here: 0, cloud: 40, both: 0, other: 0, none: 0 };
const status = (music: number, places?: PlaceCounts, ready = 0): Status => ({
  counts: { music, ready, total: music, set_aside: 0 }, places, steering: { mix_language: '', stems: '', energy_arc: null, target: null },
  moves: {}, analysis_running: false, analysing: [], mix_rendering: false, scan: { status: 'idle' },
});
const chrome = (more: Partial<LibraryPlacesChrome> = {}): LibraryPlacesChrome => ({
  accountId: 'user-1', otherDevices: false, canUpload: true, offline: false, upload: vi.fn(),
  removeFromCloud: async () => ({ songs: [], bytes_released: 0 }), ...more,
});
const connect = { request: (async () => ({})) as never, workspaceId: 'ws-1', openStore: async () => ({ all: async () => [] }) as never };

function shown(music: number, given: LibraryPlacesChrome | null, places?: PlaceCounts, ready = 0) {
  const shared = { status: status(music, places, ready) } as unknown as ViewProps;
  return render(<LibraryPlacesContext.Provider value={given}><CloudLibrary shared={shared} connected={music} connect={connect} cloudStorage /></LibraryPlacesContext.Provider>);
}

afterEach(() => { try { localStorage.clear(); } catch { /* none */ } });

describe('the Library lead with library.places', () => {
  it('is one line that says where songs are kept, with How it works and Got it', () => {
    shown(40, chrome(), PLACES);
    expect(screen.getByTestId('library-places-note')).toHaveTextContent(PLACES_NOTE_WORDS);
    expect(screen.queryByTestId('library-where-line')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));
    expect(screen.getByRole('dialog', { name: 'Where your songs are kept' })).toBeInTheDocument();
  });

  it('Got it puts it away for that person in this browser', () => {
    const first = shown(40, chrome(), PLACES);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('library-places-note')).toBeNull();
    expect(localStorage.getItem(`${PLACES_NOTE_PREFIX}user-1`)).toBe('seen');
    first.unmount();
    shown(40, chrome(), PLACES);
    expect(screen.queryByTestId('library-places-note')).toBeNull();
    shown(40, chrome({ accountId: 'user-2' }), PLACES);
    expect(screen.getByTestId('library-places-note')).toBeInTheDocument();
  });

  it('asks for no folder when every song is in the cloud library', () => {
    shown(40, chrome(), PLACES);
    expect(screen.queryByRole('heading', { name: /hasn’t been given your music/ })).toBeNull();
  });

  it('counts only songs kept on devices in the folder banner', () => {
    shown(50, chrome(), { here: 0, cloud: 40, both: 0, other: 0, none: 0 });
    expect(screen.getByRole('heading', { name: 'This browser hasn’t been given your music yet' })).toBeInTheDocument();
  });

  it('without library.places keeps the long line and the old words', () => {
    shown(40, null, undefined, 40);
    expect(screen.getByTestId('library-where-line')).toBeInTheDocument();
    expect(screen.queryByTestId('library-places-note')).toBeNull();
  });
});

describe('Add music', () => {
  it('says where each way keeps songs, and offers uploading to an account that can', () => {
    shown(40, chrome(), PLACES);
    fireEvent.click(screen.getByRole('button', { name: 'Add music' }));
    expect(screen.getByRole('menuitem', { name: 'Choose a folder (stays on this device)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Choose songs (stays on this device)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Upload to your cloud library' })).toBeInTheDocument();
  });

  it('hides uploading from an account whose grant was taken away', () => {
    shown(40, chrome({ canUpload: false }), PLACES);
    fireEvent.click(screen.getByRole('button', { name: 'Add music' }));
    expect(screen.queryByRole('menuitem', { name: 'Upload to your cloud library' })).toBeNull();
  });

  it('an empty account that can upload chooses where its songs are kept', () => {
    const given = chrome();
    shown(0, given, { here: 0, cloud: 0, both: 0, other: 0, none: 0 });
    expect(screen.getByTestId('connect-hero')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload songs' }));
    expect(given.upload).toHaveBeenCalledOnce();
  });

  it('without library.places is Connect music, as before', () => {
    shown(40, null, undefined, 40);
    expect(screen.getByRole('button', { name: 'Connect music' })).toBeInTheDocument();
  });
});

describe('the remote line', () => {
  it('counts the cloud library apart from this device', () => {
    expect(remoteLineWords(3, 10, { name: 'Laptop', online: true }, 0, 30)).toBe('30 songs are in your cloud library and 3 on this device. The rest are on Laptop.');
    expect(remoteLineWords(0, 10, { name: 'Laptop', online: false }, 0, 1)).toBe('1 song is in your cloud library. The rest are on Laptop, which isn’t open right now.');
  });
});
