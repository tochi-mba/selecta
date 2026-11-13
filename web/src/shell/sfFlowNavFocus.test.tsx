import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';

// Flow ADR-0208: the automatable parts of SF-0208-02 (desktop navigation order) and SF-0208-06
// (focus and scroll restoration). The findability study and the NVDA session stay with a person.

const backend = () => fakeBackend({
  'GET /status': status(),
  'GET /mix': () => ({ mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: true }),
  'GET /vibes': [],
  'GET /requests': { requests: [] },
  'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
  'GET /library': { songs: [], total: 0 },
});
const nav = async () => await screen.findByRole('navigation', { name: 'Main' });

let scrollY = 0;
beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/mixes');
  vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
  scrollY = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  delete (window as { scrollY?: number }).scrollY;
});

describe('SF-0208-02 desktop navigation puts the music first and keeps Workspace quiet', () => {
  it('lists Listen, Make a Mix, My Mixes and Library before Workspace, which sits apart', async () => {
    backend();
    render(<App />);
    const main = await nav();
    const links = within(main).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent);
    const places = links.filter((name) => ['Listen', 'Make a Mix', 'My Mixes', 'Library', 'Workspace'].includes(name ?? ''));
    expect(places).toEqual(['Listen', 'Make a Mix', 'My Mixes', 'Library', 'Workspace']);
    const workspace = within(main).getByRole('link', { name: 'Workspace' });
    // Workspace is its own quiet item at the end of the list, never a music destination
    expect(workspace.closest('li')).toHaveClass('nav-more');
    for (const name of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) {
      expect(within(main).getByRole('link', { name }).closest('li')).not.toHaveClass('nav-more');
    }
    // nothing in the navigation shouts: no place is styled as the page's main action
    expect(main.querySelectorAll('.primary')).toHaveLength(0);
  });
});

describe('SF-0208-06 focus and scroll survive moving around', () => {
  it('a new page starts at the top with focus at its start and is announced', async () => {
    backend();
    render(<App />);
    fireEvent.click(within(await nav()).getByRole('link', { name: 'Library' }));
    await waitFor(() => expect(document.getElementById('content')).toHaveFocus());
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
    await waitFor(() => expect(document.body.textContent).toContain('Library page'));
  });

  it('Back returns to where you were on the page before, and focus goes to the page start', async () => {
    backend();
    render(<App />);
    const main = await nav();
    scrollY = 640;
    fireEvent.click(within(main).getByRole('link', { name: 'Library' }));
    await waitFor(() => expect(window.location.pathname).toBe('/library'));
    await waitFor(() => expect(document.getElementById('content')).toHaveFocus());
    scrollY = 0;
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      window.history.back();
      await new Promise((done) => window.addEventListener('popstate', () => done(undefined), { once: true }));
    });
    await waitFor(() => expect(window.location.pathname).toBe('/mixes'));
    await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 640));
    expect(document.getElementById('content')).toHaveFocus();
    expect(within(main).getByRole('link', { name: 'Make a Mix' })).toHaveAttribute('aria-current', 'page');
  });
});
