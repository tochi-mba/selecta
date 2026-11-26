import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CloudCopy, LibrarySong, SongPlacesInfo } from '../api';
import type { MusicHolder } from '../devices/controller';
import { PlaceChip, placeParts, playLine } from './PlaceChip';

// library.places (T-20261125-67ba): the chip says where a song is kept, with an icon for each
// place, and opens its details; a separate line says only when it cannot play here.

const CLOUD: CloudCopy = { asset_id: 'a1', bytes: 5_000_000, format: 'flac', copies: 1 };
const song = (places: Partial<SongPlacesInfo>, more: Partial<LibrarySong> = {}): LibrarySong => ({
  id: 4, artist: 'Rex', title: 'Night Drive', genre: null, duration: 200, bpm: null, camelot: null, detected_bpm: null,
  detected_camelot: null, override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  lyric_status: null, never: false, priority: false, readiness: { status: 'mix_ready', reason: '' },
  places: { device: null, cloud: null, other: { devices: 0, online: [], before: [] }, ...places }, ...more,
});
const icons = (container: HTMLElement) => [...container.querySelectorAll('.place-chip [data-icon]')].map((icon) => icon.getAttribute('data-icon'));

describe('the place chip', () => {
  it('names each place in words, with an icon for each', () => {
    expect(placeParts(song({ device: 'here' })).words).toBe('On this device');
    expect(placeParts(song({ cloud: CLOUD })).words).toBe('In your cloud library');
    expect(placeParts(song({ device: 'here', cloud: CLOUD })).words).toBe('On this device and in your cloud library');
    expect(placeParts(song({ other: { devices: 1, online: ['Laptop'], before: [] } })).words).toBe('On Laptop');
    expect(placeParts(song({})).words).toBe('Not kept anywhere');
    const { container } = render(<PlaceChip song={song({ device: 'here', cloud: CLOUD })} offline={false} holder={null} onOpen={() => {}} />);
    expect(icons(container)).toEqual(['system', 'cloud']);
  });

  it('keeps the full words as the button’s name, so a phone can show the icons alone', () => {
    render(<PlaceChip song={song({ device: 'here', cloud: CLOUD })} offline={false} holder={null} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'On this device and in your cloud library' })).toBeInTheDocument();
  });

  it('a cloud copy still being measured reads Getting ready, and says where for a screen reader', () => {
    render(<PlaceChip song={song({ cloud: { ...CLOUD, measuring: true } })} offline={false} holder={null} onOpen={() => {}} />);
    expect(screen.getByText('Getting ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In your cloud library, Getting ready' })).toBeInTheDocument();
  });

  it('opens the song’s details', () => {
    const onOpen = vi.fn();
    render(<PlaceChip song={song({ device: 'here' })} offline={false} holder={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'On this device' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('whether it can play here', () => {
  const holder: MusicHolder = { deviceId: 'tablet', name: 'Tablet', songs: 3, online: false, ids: new Set([4]) };

  it('says nothing when it plays here, from this device or the cloud library', () => {
    expect(playLine(song({ device: 'here' }), false, null)).toBeNull();
    expect(playLine(song({ cloud: CLOUD }), false, null)).toBeNull();
    expect(playLine(song({ device: 'reauth', cloud: CLOUD }), false, null)).toBeNull();
  });

  it('says what stands in the way when it does not', () => {
    expect(playLine(song({ device: 'reauth' }), false, null)).toBe('Allow again to play here');
    expect(playLine(song({ cloud: CLOUD }), true, null)).toBe('Needs a connection');
    expect(playLine(song({ other: { devices: 1, online: ['Laptop'], before: [] } }), false, null)).toBe('Plays on Laptop');
    expect(playLine(song({ other: { devices: 1, online: [], before: ['Tablet'] } }), false, holder)).toBe('Open SelectaDJ on Tablet to play this.');
  });

  it('is drawn apart from the chip, and a set-aside song keeps its place', () => {
    render(<PlaceChip song={song({ device: 'reauth' })} offline={false} holder={null} onOpen={() => {}} />);
    expect(screen.getByText('Allow again to play here')).toHaveClass('place-line');
    const { container } = render(<PlaceChip song={song({ device: 'here' })} offline={false} holder={null} onOpen={() => {}} aside="Set aside" />);
    expect(within(container).getAllByRole('button', { name: 'On this device' })).toHaveLength(1);
    expect(within(container).getByText('Set aside')).toBeInTheDocument();
  });
});
