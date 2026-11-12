import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import type { Link } from '../api';
import { SongRelated } from './SongRelated';

/** CI-0177-05: only real connections for this song, each with an honest candidate label. */
const link = (a: number, b: number, phrase: string, state: Partial<Link['state']>): Link => ({
  phrase, kind: 'phrase', a, b, artist_a: `Artist ${a}`, title_a: `Song ${a}`, artist_b: `Artist ${b}`, title_b: `Song ${b}`,
  line_a: '', line_b: '', moves: ['word_blend'], move: 'word_blend', state: { status: 'none', key: 'k', ...state }, worked: false,
});

afterEach(() => vi.restoreAllMocks());

describe('CI-0177-05 validated related discoveries', () => {
  it('asks for this song only, and labels heard links apart from candidates', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      links: [
        link(1, 2, 'blue moon', { status: 'ready', passed: true }),
        link(5, 1, 'home', { status: 'ready', passed: true, fell_back: true }),
        link(3, 4, 'someone else', { status: 'ready', passed: true }),
      ], prepared: 1, preparing: 3,
    });
    render(<SongRelated song={{ id: 1, lyric_status: 'synced' }} />);
    const rows = within(await screen.findByRole('list')).getAllByRole('listitem');
    expect(get).toHaveBeenCalledWith('/links?song=1&limit=12');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('“blue moon” with Song 2 by Artist 2 Heard and kept');
    // a fallback is not a confirmed connection
    expect(rows[1]).toHaveTextContent('“home” with Song 5 by Artist 5 Candidate, not heard yet');
  });

  it('with no links says none were found, without inventing any', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ links: [], prepared: 0, preparing: 0 });
    render(<SongRelated song={{ id: 6, lyric_status: 'synced' }} />);
    expect(await screen.findByText('No word connections found with your other songs yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('with partial analysis (lyrics not timed) does not ask, and says none are known yet', () => {
    const get = vi.spyOn(api, 'get');
    render(<SongRelated song={{ id: 7, lyric_status: null }} />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText(/Connections show once this song’s lyrics are timed/)).toBeInTheDocument();
  });

  it('says so if it could not check', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    render(<SongRelated song={{ id: 1, lyric_status: 'synced' }} />);
    expect(await screen.findByText('Couldn’t check its connections just now.')).toBeInTheDocument();
  });
});
