import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CloudCopy, LibrarySong, SongPlacesInfo } from '../api';
import { HolderContext, type MusicHolder } from '../devices/controller';
import { LibraryPlacesContext, type LibraryPlacesChrome } from './LibraryPlaces';
import { SongPlaces } from './SongPlaces';

// library.places: a song's details give this device, the cloud library and each other device a
// row of their own, and offer Remove from cloud library with a warning when no copy would be left.

const CLOUD: CloudCopy = { asset_id: 'a1', bytes: 12_400_000, format: 'flac', copies: 1 };
const song = (places: Partial<SongPlacesInfo>): LibrarySong => ({
  id: 4, artist: 'Rex', title: 'Night Drive', genre: null, duration: 200, bpm: null, camelot: null, detected_bpm: null,
  detected_camelot: null, override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  lyric_status: null, never: false, priority: false, readiness: { status: 'mix_ready', reason: '' },
  places: { device: null, cloud: null, other: { devices: 0, online: [], before: [] }, ...places },
});

function chrome(more: Partial<LibraryPlacesChrome> = {}): LibraryPlacesChrome {
  return {
    accountId: 'user-1', otherDevices: false, canUpload: true, offline: false, upload: () => {},
    removeFromCloud: vi.fn(async (ids: readonly number[]) => ({ songs: ids.map((id) => ({ id, found: true, removed: 1, left_nowhere: false })), bytes_released: 1 })),
    ...more,
  };
}

function shown(one: LibrarySong, given: LibraryPlacesChrome = chrome(), holder: MusicHolder | null = null, more: { onChanged?: () => void; notify?: (words: string) => void } = {}) {
  const wrap = (children: ReactNode) => <HolderContext.Provider value={holder}><LibraryPlacesContext.Provider value={given}>{children}</LibraryPlacesContext.Provider></HolderContext.Provider>;
  return render(wrap(<SongPlaces song={one} {...more} />));
}
const row = (name: string) => screen.getByText(name, { selector: 'dt' }).parentElement!;

describe('where a song is kept', () => {
  it('gives this device and the cloud library a row each, with its size', () => {
    shown(song({ device: 'here', cloud: CLOUD }));
    expect(within(row('This device')).getByText('Plays here')).toBeInTheDocument();
    expect(within(row('Your cloud library')).getByText('12.4 MB, FLAC. Plays on all your devices')).toBeInTheDocument();
  });

  it('says how many copies are kept when there is more than one, and when one is getting ready', () => {
    shown(song({ cloud: { ...CLOUD, copies: 2, measuring: true } }));
    expect(within(row('Your cloud library')).getByText('12.4 MB, FLAC. 2 copies kept. Getting ready')).toBeInTheDocument();
    expect(within(row('This device')).getByText('Not on this device')).toBeInTheDocument();
  });

  it('gives each other device its row', () => {
    const holder: MusicHolder = { deviceId: 'laptop', name: 'Laptop', songs: 5, online: true, ids: new Set([4]) };
    shown(song({ other: { devices: 2, online: ['Laptop'], before: ['Tablet'] } }), chrome(), holder);
    expect(within(row('Laptop')).getByText('Open now')).toBeInTheDocument();
    expect(within(row('Tablet')).getByText('Not open now')).toBeInTheDocument();
  });

  it('offline, the cloud copy needs a connection', () => {
    shown(song({ cloud: CLOUD }), chrome({ offline: true }));
    expect(within(row('Your cloud library')).getByText(/Needs a connection/)).toBeInTheDocument();
  });

  it('draws nothing for the upload slot until something fills it', () => {
    const { container } = shown(song({ device: 'here' }));
    expect(container.querySelector('[data-places]')?.textContent).not.toMatch(/upload/i);
    shown(song({ device: 'here' }), chrome({ uploadActions: () => <button type="button">Slot</button> }));
    expect(screen.getByRole('button', { name: 'Slot' })).toBeInTheDocument();
  });
});

describe('Remove from cloud library', () => {
  it('warns when no copy would be left anywhere, then removes and says so', async () => {
    const given = chrome();
    const onChanged = vi.fn();
    const notify = vi.fn();
    shown(song({ cloud: CLOUD }), given, null, { onChanged, notify });
    fireEvent.click(screen.getByRole('button', { name: 'Remove from cloud library' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByTestId('places-last-copy')).toHaveTextContent('no copy of it will be left anywhere');
    expect(within(dialog).getByText(/Files on your devices are not touched/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from cloud library' }));
    await waitFor(() => expect(given.removeFromCloud).toHaveBeenCalledWith([4]));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Night Drive is no longer in your cloud library.'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('gives no warning while this device still holds the song, and counts kept copies', async () => {
    shown(song({ device: 'here', cloud: { ...CLOUD, copies: 2 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from cloud library' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByTestId('places-last-copy')).toBeNull();
    expect(within(dialog).getByText(/Its 2 copies in your cloud library are deleted \(12\.4 MB\)/)).toBeInTheDocument();
  });

  it('is not offered for a song with no cloud copy', () => {
    shown(song({ device: 'here' }));
    expect(screen.queryByRole('button', { name: 'Remove from cloud library' })).toBeNull();
  });
});

describe('without library.places', () => {
  it('is as before: nothing without another device', () => {
    const { container } = render(<SongPlaces song={song({ device: 'here' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
