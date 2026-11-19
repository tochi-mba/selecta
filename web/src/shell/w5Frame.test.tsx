import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { announce } from '../ui/controls';
import { clearToasts, showProblem } from '../ui/toasts';
import { whenShown } from './Shell';

// W5: the screens before the shell get the toasts and the live region, and the '/' shortcut waits for
// the Library's search box instead of guessing when it has painted.

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
});
afterEach(() => clearToasts());

describe('the first screen has a frame', () => {
  it('shows a problem toast and speaks through the live region before any music is added', async () => {
    window.history.replaceState({}, '', '/');
    fakeBackend({
      'GET /status': status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, lyrics: 0 } }),
      'GET /mix': { mix: [], name: 'Your mix', can_undo: false },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Where’s your music?' })).toBeInTheDocument();
    act(() => showProblem('That folder went away.'));
    expect(await screen.findByText('That folder went away.')).toBeInTheDocument();
    act(() => announce('Reading your folder'));
    await waitFor(() => expect(document.body.textContent).toContain('Reading your folder'));
  });
});

describe('the / shortcut', () => {
  it('goes to the Library from another page and puts you in its search box once it is there', async () => {
    window.history.replaceState({}, '', '/mixes');
    fakeBackend({
      'GET /status': status(),
      'GET /mix': () => ({ mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: false }),
      'GET /vibes': [],
      'GET /requests': { requests: [] },
      'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
      'GET /library': { songs: [], total: 0 },
    });
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    fireEvent.keyDown(document.body, { key: '/', code: 'Slash' });
    await waitFor(() => expect(window.location.pathname).toBe('/library'));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search your library' })).toHaveFocus());
  });
});

describe('whenShown', () => {
  it('answers at once when the thing is already there, later when it arrives, and never after it stops', async () => {
    const seen = vi.fn();
    whenShown(() => document.body, seen);
    expect(seen).toHaveBeenCalledWith(document.body);

    const later = vi.fn();
    whenShown(() => document.getElementById('w5-later'), later);
    const arriving = document.createElement('p');
    arriving.id = 'w5-later';
    document.body.append(arriving);
    await waitFor(() => expect(later).toHaveBeenCalledWith(arriving));
    expect(later).toHaveBeenCalledOnce();

    const never = vi.fn();
    const stop = whenShown(() => document.getElementById('w5-never'), never);
    stop();
    const late = document.createElement('p');
    late.id = 'w5-never';
    document.body.append(late);
    await new Promise((done) => setTimeout(done, 20));
    expect(never).not.toHaveBeenCalled();
    arriving.remove();
    late.remove();
  });
});
