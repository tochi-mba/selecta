import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { App } from './App';
import { SetPlayer } from './player';
import { fakeBackend, seam, songs, status } from './test/backend';

const data = (...items: Parameters<typeof songs>) => ({ mix: songs(...items), name: 'Test mix', can_undo: false });

const navigation = async () => within(await screen.findByRole('navigation', { name: 'Main' }));

// every test starts at the front door, and the address is part of what each one checks
beforeEach(() => window.history.pushState({}, '', '/'));

function backend(mix: () => unknown) {
  return fakeBackend({
    'GET /status': status(),
    'GET /mix': mix,
    'GET /vibes': [],
  });
}

describe('the badges', () => {
  it('follow the worker by themselves, without anyone pressing anything', async () => {
    let reads = 0;
    backend(() => {
      reads += 1;
      return reads < 4 ? data(seam('none', 'a')) : data(seam('ready', 'a', { duration: 30, a_source_start: 100, b_source_end: 10 }));
    });
    render(<App />);
    await userEvent.click((await navigation()).getByRole('link', { name: 'Edit' }));
    expect(await screen.findByText('Waiting to render')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument(), { timeout: 6000 });
  });

  it('stop asking once nothing is left to wait for', async () => {
    const mix = vi.fn(() => data(seam('ready', 'a', { duration: 30, a_source_start: 100, b_source_end: 10 })));
    backend(mix);
    render(<App />);
    await navigation();
    await waitFor(() => expect(mix).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 400));
    const settled = mix.mock.calls.length;
    await new Promise((done) => setTimeout(done, 1800));
    expect(mix.mock.calls.length).toBe(settled);
  });
});

describe('when the mix can’t be read', () => {
  it('says so rather than showing an empty mix in silence', async () => {
    fakeBackend({ 'GET /status': status(), 'GET /vibes': [] });
    render(<App />);
    expect(await screen.findByText(/Couldn’t read your mix: Not Found/)).toBeInTheDocument();
  });
});

describe('a first run', () => {
  it('asks where the music is before anything else', async () => {
    fakeBackend({
      'GET /status': status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, lyrics: 0 } }),
      'GET /mix': { mix: [], name: 'Your mix', can_undo: false },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Where’s your music?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('keyboard shortcuts', () => {
  it('opens the list with ? and closes it with Escape', async () => {
    backend(() => data(seam('none', 'a')));
    render(<App />);
    await navigation();
    await userEvent.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('requests across the app', () => {
  const list = { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false };

  it('are a press away on any page, and a song a request added is marked in Edit', async () => {
    const mix = songs(seam('ready', 'a'));
    mix[1].from_request = { kind: 'requested' };
    fakeBackend({
      'GET /status': status(),
      'GET /mix': { mix, name: 'Test mix', can_undo: false },
      'GET /vibes': [],
      'GET /drafts': list,
      'GET /requests': { requests: [{ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1 }] },
    });
    render(<App />);
    fireEvent.click((await navigation()).getByRole('link', { name: 'Edit' }));
    expect(await screen.findByText('Requested')).toBeInTheDocument();
    fireEvent.click((await navigation()).getByRole('button', { name: /^Requests/ }));
    expect(await screen.findByText('Wanted')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Song requests' })).toBeInTheDocument();
  });

  it('aren’t on pages they’d get in the way of', async () => {
    fakeBackend({
      'GET /status': status(),
      'GET /mix': { mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: false },
      'GET /vibes': [],
      'GET /drafts': list,
      'GET /requests': { requests: [] },
    });
    render(<App />);
    await screen.findByText('Pick a feeling');
    expect(screen.queryByRole('region', { name: 'Song requests' })).toBeNull();
  });
});

describe('an open draft', () => {
  const list = (drafts: { id: number; name: string }[]) => ({
    drafts: drafts.map((draft) => ({ songs: 2, seconds: 400, seams: 1, ready: 0, failed: 0, waiting: 1, rendering: false, place: null, eta: null, to_render: 60, missing: 0, ...draft })),
    current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
    out_of_room: false,
  });
  const current = { mix: songs(seam('ready', 'a')), name: 'Current', can_undo: false };
  const friday = { mix: songs(seam('none', 'b')), name: 'Friday', can_undo: true, draft: { id: 7, place: null } };

  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
  });

  it('opens from the list without touching the current mix, and stays open after a reload', async () => {
    window.history.pushState({}, '', '/mixes/mine');
    const calls = fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': list([{ id: 7, name: 'Friday' }]),
      'GET /mix': (_body: unknown, url: string) => (url.includes('draft=7') ? friday : current),
    });
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Friday' }));
    expect(await screen.findByRole('heading', { name: 'Friday' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/mixes/drafts/7/edit');
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
    unmount();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Friday' })).toBeInTheDocument();
  });

  it('says so if the draft has gone, rather than quietly showing another mix', async () => {
    window.history.pushState({}, '', '/mixes/drafts/99/edit');
    fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': list([]),
      'GET /mix': (_body: unknown, url: string) => {
        if (url.includes('draft=99')) throw new ApiError('gone', 404);
        return current;
      },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: /That draft isn’t there/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See my mixes' })).toHaveAttribute('href', '/mixes/mine');
  });

  it('being sent to Edit from another page means the mix that’s playing', async () => {
    window.history.pushState({}, '', '/mixes/drafts/7/edit');
    fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': list([{ id: 7, name: 'Friday' }]),
      'GET /mix': (_body: unknown, url: string) => (url.includes('draft=7') ? friday : current),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Friday' })).toBeInTheDocument();
    fireEvent.click((await navigation()).getByRole('link', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Current' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/mix/current/edit');
  });

  it('playing one goes to Listen, and keeps what was playing in the drafts', async () => {
    window.history.pushState({}, '', '/mixes/mine');
    fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': list([{ id: 7, name: 'Friday' }]),
      'GET /mix': (_body: unknown, url: string) => (url.includes('draft=7') ? friday : current),
      'POST /drafts/7/play': { ...current, name: 'Friday' },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play Friday' }));
    await waitFor(() => expect(window.location.pathname).toBe('/listen'));
    expect(await screen.findByText(/What was playing is kept in your drafts/)).toBeInTheDocument();
  });
});

