import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clock } from './Shell';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';

const data = () => ({ mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: true });
const backend = (more: Record<string, unknown> = {}) => fakeBackend({
  'GET /status': status(),
  'GET /mix': data,
  'GET /vibes': [],
  'GET /requests': { requests: [] },
  'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
  ...more,
});
const nav = async () => within(await screen.findByRole('navigation', { name: 'Main' }));

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  window.history.pushState({}, '', '/mixes');
  vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
});

describe('stable player and keyboard geometry', () => {
  it('formats missing or non-finite timing without NaN or Infinity', () => {
    expect(clock(Number.NaN)).toBe('0:00');
    expect(clock(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(clock(Number.NEGATIVE_INFINITY)).toBe('0:00');
    expect(clock(-5)).toBe('0:00');
    expect(clock(61.9)).toBe('1:01');
  });

  it('only yields chrome to a real editor keyboard, not pinch zoom or a blurred input', async () => {
    backend();
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight - 260,
      offsetTop: 0,
      scale: 2,
    });
    vi.stubGlobal('visualViewport', viewport);
    const input = document.createElement('input');
    document.body.append(input);
    try {
      render(<App />);
      await nav();
      input.focus();
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(document.documentElement.dataset.keyboard).toBeUndefined();
      expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');

      viewport.scale = 1;
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(document.documentElement.dataset.keyboard).toBe('open');
      expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('260px');

      input.blur();
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(document.documentElement.dataset.keyboard).toBeUndefined();
      expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    } finally {
      input.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe('getting around', () => {
  it('has the five places, each a real link', async () => {
    backend();
    render(<App />);
    const links = await nav();
    for (const [name, path] of [['Listen', '/listen'], ['Make a Mix', '/mixes'], ['My Mixes', '/mixes/mine'], ['Library', '/library'], ['Workspace', '/workshop']]) {
      expect(links.getByRole('link', { name })).toHaveAttribute('href', path);
    }
  });

  it('marks where you are', async () => {
    backend();
    render(<App />);
    const links = await nav();
    expect(links.getByRole('link', { name: 'Make a Mix' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(links.getByRole('link', { name: 'Library' }));
    await waitFor(() => expect(window.location.pathname).toBe('/library'));
    expect(links.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
    expect(links.getByRole('link', { name: 'Make a Mix' })).not.toHaveAttribute('aria-current');
  });

  it('only offers Edit once there’s a mix to edit', async () => {
    fakeBackend({ 'GET /status': status(), 'GET /mix': { mix: [], name: 'Your mix', can_undo: false }, 'GET /vibes': [], 'GET /requests': { requests: [] }, 'GET /drafts': { drafts: [], current: { name: '', songs: 0, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false } });
    render(<App />);
    expect((await nav()).queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('a link opened in a new tab is left to the browser', async () => {
    backend();
    render(<App />);
    fireEvent.click((await nav()).getByRole('link', { name: 'Library' }), { ctrlKey: true });
    expect(window.location.pathname).toBe('/mixes');
  });

  it('an address that goes nowhere says so, and offers a way back', async () => {
    window.history.pushState({}, '', '/nowhere');
    backend();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'There’s nothing at this address.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Make a Mix' })).toHaveAttribute('href', '/mixes');
  });

  it('goes straight to the right page from a link', async () => {
    window.history.pushState({}, '', '/workshop/sources');
    backend({ 'GET /folders': { folders: [], watch_every: 60 } });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your music folders' })).toBeInTheDocument();
  });

  it('puts focus at the start of a new page', async () => {
    backend();
    render(<App />);
    fireEvent.click((await nav()).getByRole('link', { name: 'Library' }));
    await waitFor(() => expect(document.getElementById('content')).toHaveFocus());
  });

  it('has a way to skip straight past the navigation', async () => {
    backend();
    render(<App />);
    await nav();
    expect(screen.getByRole('link', { name: 'Skip to the page' })).toHaveAttribute('href', '#content');
  });

  it('nothing here restarts the music', async () => {
    backend();
    const playFrom = vi.mocked(SetPlayer.prototype.playFrom);
    render(<App />);
    const links = await nav();
    fireEvent.click(links.getByRole('link', { name: 'Library' }));
    fireEvent.click(links.getByRole('link', { name: 'Workspace' }));
    expect(playFrom).not.toHaveBeenCalled();
  });
});

describe('requests', () => {
  it('open from anywhere, and close again', async () => {
    backend();
    render(<App />);
    fireEvent.click((await nav()).getByRole('button', { name: 'Requests: Request a song' }));
    const drawer = await screen.findByRole('dialog', { name: 'Requests' });
    expect(within(drawer).getByRole('combobox', { name: 'Request a song' })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close Requests' }));
    expect(screen.queryByRole('dialog', { name: 'Requests' })).toBeNull();
  });

  it('show how many are waiting', async () => {
    backend({ 'GET /requests': { requests: [{ id: 1, song_id: 9, title: 'Wanted', artist: 'A', status: 'waiting', available: 1 }] } });
    render(<App />);
    expect(await (await nav()).findByRole('button', { name: 'Requests: Request a song, 1 waiting' })).toBeInTheDocument();
  });

  it('open with R', async () => {
    backend();
    render(<App />);
    await nav();
    fireEvent.keyDown(window, { key: 'r' });
    expect(await screen.findByRole('dialog', { name: 'Requests' })).toBeInTheDocument();
  });
});

describe('when the server goes away', () => {
  it('says so across the top, and what’s on screen stays', async () => {
    let up = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!up) throw new TypeError('Failed to fetch');
      if (url.includes('/status')) return new Response(JSON.stringify(status()), { status: 200 });
      if (url.includes('/mix')) return new Response(JSON.stringify(data()), { status: 200 });
      if (url.includes('/requests')) return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<App />);
      await nav();
      up = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      expect(await screen.findByText('Can’t reach Selecta.')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
      up = true;
      fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
      await waitFor(() => expect(screen.queryByText('Can’t reach Selecta.')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so plainly if it was never there at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Can’t reach Selecta.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument();
  });
});

describe('an Undo', () => {
  it('undoes the mix it was about, even after moving to another page', async () => {
    window.history.pushState({}, '', '/mixes/drafts/7/edit');
    const friday = { mix: songs(seam('ready', 'b'), seam('ready', 'c')), name: 'Friday', can_undo: true, draft: { id: 7, place: null } };
    const calls = backend({
      'GET /mix': (_body: unknown, url: string) => (url.includes('draft=7') ? friday : data()),
      'POST /mix/move': friday,
      'POST /mix/undo': { ...friday, undone: 'moving a song' },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move Song 2 up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/mix/undo?draft=7')).toBe(true));
    expect(calls.some((call) => call.path === '/mix/undo')).toBe(false);
  });
});

describe('the keyboard', () => {
  it('Z will not mutate a draft until its exact identity and Undo state have loaded', async () => {
    window.history.pushState({}, '', '/mixes/drafts/7/edit');
    const friday = { mix: songs(seam('ready', 'b')), name: 'Friday', can_undo: true, draft: { id: 7, place: null } };
    const calls = backend({
      'GET /mix': (_body: unknown, url: string) => url.includes('draft=7') ? friday : data(),
      'POST /mix/undo': { ...friday, undone: 'a draft change' },
    });
    render(<App />);
    // The first press is before the requested draft has been returned.
    fireEvent.keyDown(window, { key: 'z' });
    expect(calls.some((call) => call.path.startsWith('/mix/undo'))).toBe(false);

    await screen.findByRole('button', { name: 'Move Song 2 up' });
    fireEvent.keyDown(window, { key: 'z' });
    await waitFor(() => expect(calls.some((call) => call.path === '/mix/undo?draft=7')).toBe(true));
    expect(calls.some((call) => call.path === '/mix/undo')).toBe(false);
  });

  it('Z does not post an Undo request when the current mix has no reversible edit', async () => {
    const calls = backend({ 'GET /mix': { ...data(), can_undo: false } });
    render(<App />);
    await nav();
    fireEvent.keyDown(window, { key: 'z' });
    expect(calls.filter((call) => call.path.startsWith('/mix/undo'))).toHaveLength(0);
  });
  it('leaves typing alone', async () => {
    backend();
    const skip = vi.spyOn(SetPlayer.prototype, 'skip').mockImplementation(async () => {});
    render(<App />);
    await nav();
    const box = document.createElement('input');
    document.body.append(box);
    fireEvent.keyDown(box, { key: 'n' });
    expect(skip).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'n' });
    expect(skip).toHaveBeenCalled();
    box.remove();
  });

  it('N jumps to the transition, and Shift N goes to the next song', async () => {
    backend();
    const skip = vi.spyOn(SetPlayer.prototype, 'skip').mockImplementation(async () => {});
    const next = vi.spyOn(SetPlayer.prototype, 'next').mockImplementation(async () => {});
    render(<App />);
    await nav();
    fireEvent.keyDown(window, { key: 'n' });
    expect(skip).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'N', shiftKey: true });
    expect(next).toHaveBeenCalledOnce();
  });

  it('M mutes', async () => {
    backend();
    const mute = vi.spyOn(SetPlayer.prototype, 'toggleMute').mockImplementation(() => {});
    render(<App />);
    await nav();
    fireEvent.keyDown(window, { key: 'm' });
    expect(mute).toHaveBeenCalled();
  });
});

// S3-0048-07 and S3-0049-07: titles, breadcrumbs and the collapsible rail
describe('where you are, said three ways', () => {
  it('names the page in the title and the breadcrumb, with its parent one step back', async () => {
    window.history.pushState({}, '', '/discover/harmonic');
    backend();
    render(<App />);
    const crumbs = within(await screen.findByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByRole('link', { name: 'Make a Mix' })).toHaveAttribute('href', '/mixes');
    expect(crumbs.getByText('Harmonic matches')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe('Harmonic matches · Selecta'));
    fireEvent.click((await nav()).getByRole('link', { name: 'Library' }));
    await waitFor(() => expect(document.title).toBe('Library · Selecta'));
  });

  it('marks My Mixes as the parent while a mix is being edited', async () => {
    window.history.pushState({}, '', '/mix/current/edit');
    backend();
    render(<App />);
    const links = await nav();
    expect(links.getByRole('link', { name: 'My Mixes' })).toHaveAttribute('aria-current', 'true');
    expect(links.getByRole('link', { name: 'Edit' })).toHaveAttribute('aria-current', 'page');
  });

  it('collapses the rail with every place still named, and remembers it after a reload', async () => {
    backend();
    const first = render(<App />);
    const links = await nav();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the side bar' }));
    expect(document.documentElement.dataset.rail).toBe('collapsed');
    expect(screen.getByRole('button', { name: 'Expand the side bar' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) {
      expect(links.getByRole('link', { name })).toHaveAttribute('data-tip', name);
    }
    expect(links.getByRole('link', { name: 'Make a Mix' })).toHaveAttribute('aria-current', 'page');
    first.unmount();
    render(<App />);
    await nav();
    expect(document.documentElement.dataset.rail).toBe('collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Expand the side bar' }));
    expect(document.documentElement.dataset.rail).toBe('open');
  });
});
