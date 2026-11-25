import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySong, Request } from '../api';
import { setFlags } from '../flags';
import { resetArtStoreForTests } from '../media/artStore';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { RequestContext } from '../requestContext';
import { CoverArt } from './CoverArt';
import { SongCatalog } from './SongCatalog';

/** ADR-0478 FL-0478-04: in Cloud a song whose file has no picture shows the catalogue's cover;
 * "Wrong cover?" picks another candidate or the generated tile, and that choice shows on every
 * cover of the song at once. The album and year are suggestions beside the song, never written to
 * its tags. Recorded answers stand in for the server: nothing here reaches MusicBrainz or the
 * Cover Art Archive. */

const SONG = { id: 4, title: 'Say It Ain’t So', artist: 'Weezer', duration: 258 } as LibrarySong;
const ART = { id: 'art-1', url: '/api/catalog/art/art-1/500', sizes: { 500: '/api/catalog/art/art-1/500' }, hue: 210, source: 'caa-release' };
const DETAILS = { recording_id: 'rec-1', release_id: 'rel-1', title: 'Say It Ain’t So', artist: 'Weezer', album: 'Weezer', year: 1994, isrc: null };
const MATCHED = { song_id: 4, state: 'matched', chosen: false, art: ART, confidence: 0.96, method: 'search', details: DETAILS };
const GENERATED = { song_id: 4, state: 'generated', art: null, confidence: null, method: null, details: null };
const CANDIDATES = {
  song_id: 4,
  choice: 'auto',
  outcome: 'matched',
  releases: [
    { release_id: 'rel-1', title: 'Weezer', artist: 'Weezer', date: '1994-05-10', year: 1994, status: 'Official', type: 'Album', cover: 'present', art: ART, current: true },
    { release_id: 'rel-2', title: 'Live at the Garage', artist: 'Weezer', date: '1996', year: 1996, status: 'Bootleg', type: 'Live', cover: 'present', art: null, current: false },
  ],
};

type Call = { method: string; path: string; body: unknown };

function recorded() {
  const calls: Call[] = [];
  let song: object = MATCHED;
  let choice = 'auto';
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    if (method === 'POST' && path === '/catalog/art') return { songs: [song], queued: 0, lookups_allowed: true };
    if (method === 'GET' && path === '/catalog/songs/4/candidates') return { ...CANDIDATES, choice };
    if (method === 'PUT' && path === '/catalog/songs/4/choice') {
      choice = body.choice;
      song = body.choice === 'generated' ? GENERATED : MATCHED;
      return { song, cover_pending: false };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as unknown as Request;
  return { request, calls };
}

const images = (container: HTMLElement) => [...container.querySelectorAll<HTMLImageElement>('.cover-art img')];

beforeEach(() => {
  resetArtStoreForTests();
  vi.stubGlobal('indexedDB', fakeIndexedDb());
});

afterEach(() => {
  resetArtStoreForTests();
});

function page(request: Request, notify = vi.fn()) {
  return render(
    <RequestContext.Provider value={request}>
      <SongCatalog song={SONG} notify={notify} />
      <span className="elsewhere"><CoverArt seed={4} songId={4} /></span>
    </RequestContext.Provider>,
  );
}

describe('FL-0478-04 catalogue covers and "Wrong cover?"', () => {
  it('shows the catalogue cover, and the album and year as suggestions only', async () => {
    const { request, calls } = recorded();
    const { container } = page(request);
    await waitFor(() => expect(images(container)).toHaveLength(1));
    expect(images(container)[0]).toHaveAttribute('src', '/api/catalog/art/art-1/500');
    expect(screen.getByText('Release year').nextSibling).toHaveTextContent('1994');
    expect(screen.getByText('Album').nextSibling).toHaveTextContent('Weezer');
    expect(screen.getByText(/Your file’s own tags are not changed/)).toBeInTheDocument();
    // every cover on the page asked in one read
    expect(calls.filter((call) => call.path === '/catalog/art')).toHaveLength(1);
    expect(calls.some((call) => call.method !== 'GET' && call.method !== 'POST')).toBe(false);
  });

  it('picks the generated tile, and every cover of the song follows at once', async () => {
    const { request, calls } = recorded();
    const notify = vi.fn();
    const { container } = page(request, notify);
    await waitFor(() => expect(images(container)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Wrong cover?' }));
    expect(screen.getByRole('button', { name: 'Wrong cover?' })).toHaveAttribute('aria-expanded', 'true');
    const tile = await screen.findByRole('button', { name: /The generated tile/ });
    expect(screen.getByRole('button', { name: /Live at the Garage/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Weezer/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tile);
    await waitFor(() => expect(images(container)).toHaveLength(0));
    expect(calls.find((call) => call.method === 'PUT')).toEqual({ method: 'PUT', path: '/catalog/songs/4/choice', body: { choice: 'generated', release_id: null } });
    expect(notify).toHaveBeenCalledWith('This song shows its generated tile now.');
    await waitFor(() => expect(screen.getByRole('button', { name: /The generated tile/ })).toHaveAttribute('aria-pressed', 'true'));
    // the person can go back to letting SelectaDJ choose
    expect(screen.getByRole('button', { name: 'Let SelectaDJ choose' })).toBeInTheDocument();
  });

  it('is not there at all with library.art_lookup off, and asks nothing', async () => {
    setFlags({ 'library.art_lookup': false });
    const { request, calls } = recorded();
    const { container } = page(request);
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(container.querySelector('.song-catalog')).toBeNull();
    expect(images(container)).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it('asks nothing in the local app, which has no catalogue', async () => {
    const { container } = render(<><SongCatalog song={SONG} notify={vi.fn()} /><CoverArt seed={4} songId={4} /></>);
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(container.querySelector('.song-catalog')).toBeNull();
    expect(images(container)).toHaveLength(0);
  });
});
