import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryPage, LibrarySong, PlaceCounts, Request, SongPlacesInfo } from '../api';
import { SetPlayer } from '../player';
import { status } from '../test/backend';
import { Library } from './Library';
import { LibraryPlacesContext, type LibraryPlacesChrome } from './LibraryPlaces';

// library.places: the Library in a Cloud shell with a cloud library filters by place. With
// ?show=cloud it asks for the songs in the cloud library, offers Largest, presses that chip, and a
// selection can be removed from the cloud library.

const row = (id: number, title: string, places: Partial<SongPlacesInfo>): LibrarySong => ({
  id, artist: 'Rex', title, genre: null, duration: 200, bpm: null, camelot: null, lyric_status: null, never: false, priority: false,
  detected_bpm: null, detected_camelot: null, override_bpm: null, override_camelot: null, music_override: null, energy: null,
  grid_confidence: null, readiness: { status: 'mix_ready', reason: '' }, availability: places.device === 'here' ? 'here' : 'hosted',
  places: { device: null, cloud: null, other: { devices: 0, online: [], before: [] }, ...places },
});
const CLOUD = { asset_id: 'a', bytes: 8_000_000, format: 'mp3', copies: 1 };
const PAGE: LibraryPage = { songs: [row(1, 'Big One', { cloud: CLOUD }), row(2, 'Small One', { device: 'here', cloud: { ...CLOUD, bytes: 2_000_000 } })], total: 2, next: null };
const PLACES: PlaceCounts = { here: 1, cloud: 2, both: 1, other: 0, none: 0 };

function chrome(more: Partial<LibraryPlacesChrome> = {}): LibraryPlacesChrome {
  return {
    accountId: 'user-1', otherDevices: false, canUpload: true, offline: false, upload: () => {},
    removeFromCloud: vi.fn(async (ids: readonly number[]) => ({ songs: ids.map((id) => ({ id, found: true, removed: 1, left_nowhere: id === 1 })), bytes_released: 10 })),
    ...more,
  };
}

function shown(address: string, given: LibraryPlacesChrome | null = chrome()) {
  window.history.pushState({}, '', address);
  const asked: string[] = [];
  const request = (async (path: string) => { asked.push(path); return PAGE; }) as Request;
  const player = new SetPlayer(() => [], () => {});
  const notify = vi.fn();
  render(
    <LibraryPlacesContext.Provider value={given}>
      <Library status={status({ places: PLACES })} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}} request={request}
        refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={notify} stage={false} toggleStage={() => {}} browser={{ action: null }} />
    </LibraryPlacesContext.Provider>,
  );
  return { asked, notify };
}

afterEach(() => cleanup());

describe('the Library with ?show=cloud', () => {
  it('asks for the cloud library songs, presses that chip and offers Largest', async () => {
    const { asked } = shown('/library?show=cloud&sort=largest');
    await screen.findByText('Big One');
    expect(asked.some((path) => path.includes('state=cloud') && path.includes('sort=largest'))).toBe(true);
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).getAllByRole('button').map((button) => button.textContent)).toEqual(['All', 'On this device', 'In your cloud library', 'Needs attention', 'Set aside']);
    expect(within(chips).getByRole('button', { name: 'In your cloud library' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('option', { name: 'Largest' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('largest');
  });

  it('the header counts the places', async () => {
    shown('/library?show=cloud');
    await screen.findByText('Big One');
    // what is read out: a rolling count draws every digit for its motion, aria-hidden
    const spoken = (id: string) => [...screen.getByTestId(id).childNodes].map((node) => (node instanceof HTMLElement ? node.querySelector('.visually-hidden')?.textContent ?? node.textContent : node.textContent)).join('');
    expect(spoken('library-here')).toBe('1 on this device');
    expect(spoken('library-cloud')).toBe('2 in your cloud library');
  });

  it('Largest is not offered away from the cloud library, and asks by title there', async () => {
    const { asked } = shown('/library?show=here&sort=largest');
    await screen.findByText('Big One');
    expect(screen.queryByRole('option', { name: 'Largest' })).toBeNull();
    expect(asked.every((path) => !path.includes('sort=largest'))).toBe(true);
  });

  it('Set aside combines with a place, and On another device shows only with other devices', async () => {
    const { asked } = shown('/library?show=cloud&aside=1', chrome({ otherDevices: true }));
    await waitFor(() => expect(asked.some((path) => path.includes('state=set_aside%3Acloud'))).toBe(true));
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).getByRole('button', { name: 'Set aside' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: 'In your cloud library' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: 'On another device' })).toBeInTheDocument();
  });

  it('old ready links still filter as before', async () => {
    const { asked } = shown('/library?show=ready');
    await screen.findByText('Big One');
    expect(asked.some((path) => path.includes('state=ready'))).toBe(true);
    expect(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Plays here' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a selection is removed from the cloud library after its confirmation', async () => {
    const given = chrome();
    const { notify } = shown('/library?show=cloud', given);
    await screen.findByText('Big One');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from cloud library' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove 2 songs from your cloud library?' });
    expect(within(dialog).getByTestId('places-last-copy')).toHaveTextContent('1 of these songs is not on any of your devices');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from cloud library' }));
    await waitFor(() => expect(given.removeFromCloud).toHaveBeenCalledWith([1, 2]));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('2 songs are no longer in your cloud library. One song has no copy left anywhere.'));
  });
});

describe('without library.places', () => {
  it('the filters are as before', async () => {
    shown('/library', null);
    await screen.findByText('Big One');
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).queryByRole('button', { name: 'In your cloud library' })).toBeNull();
    expect(screen.queryByTestId('library-cloud')).toBeNull();
  });
});
