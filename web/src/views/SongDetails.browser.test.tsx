import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LibrarySong } from '../api';
import { setFlags } from '../flags';
import { SongDetails } from './SongDetails';

// A device-music Cloud library (analysedHere false): a song the account has measured shows its
// tempo and key and can be corrected; "Is it music?" is the member's own mark, kept by the
// account (T-20261126-3f92); a song nobody has measured has no tempo and key to correct.

const song = (more: Partial<LibrarySong> = {}): LibrarySong => ({
  id: 9, artist: 'Example Artist', title: 'Example Song', genre: null, duration: 200, bpm: 120, camelot: '8A',
  detected_bpm: 120, detected_camelot: '8A', override_bpm: null, override_camelot: null, music_override: null,
  energy: 0.5, grid_confidence: null, lyric_status: null, never: false, priority: false,
  readiness: { status: 'mix_ready', reason: '' }, ...more,
});

const details = (one: LibrarySong, measured: boolean) => render(
  <SongDetails song={one} measured={measured} analysedHere={false} onClose={() => {}} onChanged={() => {}} notify={() => {}} onPriority={async () => {}} onNever={async () => {}} />,
);

describe('Song details in a browser library', () => {
  afterEach(() => setFlags(null));

  it('a measured song shows its tempo and key and offers the correction and "Is it music?"', () => {
    details(song(), true);
    expect(screen.getAllByText('120 BPM').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Correct it' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Is it music?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This isn’t music' })).toBeInTheDocument();
    // a browser never decides by itself, so there is nothing to hand back to
    expect(screen.queryByRole('button', { name: 'Let SelectaDJ decide' })).toBeNull();
  });

  it('a set-aside song offers to count it as music again', () => {
    details(song({ music_override: 0, readiness: { status: 'set_aside', reason: 'You set this aside.' } }), true);
    expect(screen.getByRole('button', { name: 'This is music' })).toBeInTheDocument();
  });

  it('a song nobody has measured shows neither', () => {
    details(song({ bpm: null, camelot: null, detected_bpm: null, detected_camelot: null }), false);
    expect(screen.queryByText('Tempo in use')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Correct it' })).toBeNull();
  });

  it('with corrections switched off the section is absent and the sheet reflows', () => {
    setFlags({ 'library.corrections': false });
    details(song(), true);
    expect(screen.queryByRole('heading', { name: 'Correct it' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Is it music?' })).toBeNull();
    expect(screen.getByText('Tempo in use')).toBeInTheDocument();
  });
});
