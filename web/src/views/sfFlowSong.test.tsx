import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LibrarySong } from '../api';
import { setFlags } from '../flags';
import { capabilities } from '../state/capabilities';
import { SongDetails } from './SongDetails';

const song = (more: Partial<LibrarySong> = {}): LibrarySong => ({
  id: 9, artist: 'Example Artist', title: 'Example Song', genre: 'pop', duration: 200, bpm: 120, camelot: '8A',
  detected_bpm: 120, detected_camelot: '8A', override_bpm: null, override_camelot: null, music_override: null,
  energy: 0.5, grid_confidence: 0.9, lyric_status: 'synced', never: false, priority: false,
  readiness: { status: 'mix_ready', reason: '' }, ...more,
});

const read = (one: LibrarySong) => Object.fromEntries(capabilities(one).map((item) => [item.name, `${item.kind}: ${item.words}`]));

// SF-0227-03: play, mixes, stems and lyrics each have their own state, and one never borrows another's.
describe('SF-0227-03 readiness by capability', () => {
  afterEach(() => setFlags(null));

  it('lets a song be playable but not mix-ready, with lyrics not looked up and stems waiting on analysis', () => {
    expect(read(song({ bpm: null, lyric_status: null, readiness: { status: 'queued', reason: '' } }))).toEqual({
      Play: 'ready: The file is here and can play',
      Mixes: 'queued: Waiting to be analysed',
      Stems: 'queued: Possible after analysis',
      Lyrics: 'queued: Not looked up yet',
    });
  });

  it('lets a mix-ready song have untimed lyrics, and says stems are only split when a transition asks', () => {
    expect(read(song({ lyric_status: 'plain' }))).toEqual({
      Play: 'ready: The file is here and can play',
      Mixes: 'ready: Ready for mixes',
      Stems: 'queued: Split when a transition needs them',
      Lyrics: 'warning: Not timed',
    });
    expect(read(song({ priority: true })).Stems).toBe('queued: Split when a transition needs them, and kept when space is cleared');
  });

  it('a missing file can’t play, and nothing downstream claims to be ready', () => {
    const facts = read(song({ readiness: { status: 'missing', reason: '' } }));
    expect(facts.Play).toBe('failed: File is missing');
    expect(facts.Mixes).toBe('failed: File is missing');
    expect(facts.Stems).toMatch(/^unavailable/);
    // timed lyrics are still known, and are not hidden by the missing file
    expect(facts.Lyrics).toBe('ready: Timed');
  });

  it('an unrecognised state is unknown everywhere it matters, never promoted to ready', () => {
    const facts = read(song({ readiness: { status: 'something-new', reason: '' } }));
    expect(facts.Play).toBe('unavailable: State unknown');
    expect(facts.Mixes).toBe('unavailable: State unknown');
  });

  it('Song Details lists each capability on its own row, and closes up when the flag is off', () => {
    const view = render(<SongDetails song={song({ lyric_status: null })} onClose={() => {}} onChanged={() => {}} notify={() => {}} onPriority={async () => {}} onNever={async () => {}} />);
    const list = screen.getByLabelText(/What it.s ready for/);
    for (const name of ['Play', 'Mixes', 'Stems', 'Lyrics']) expect(within(list).getByText(name)).toBeInTheDocument();
    expect(within(list).getByText('Not looked up yet')).toBeInTheDocument();
    view.unmount();
    setFlags({ 'library.capability_readiness': false });
    render(<SongDetails song={song()} onClose={() => {}} onChanged={() => {}} notify={() => {}} onPriority={async () => {}} onNever={async () => {}} />);
    expect(screen.queryByLabelText(/What it.s ready for/)).toBeNull();
  });
});
