import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { saveResume } from './lib';
import { SetPlayer } from './player';
import { clearToasts } from './ui/toasts';
import { fakeBackend, seam, songs, status } from './test/backend';

// EX-0115-03: where the app opens depends on what the listener was doing, but an
// address that says where to go always wins, and arriving never starts the music.

const mix = { mix: songs(seam('ready', 'a'), seam('ready', 'b')), name: 'Current', can_undo: false };

function backend(current: unknown = mix) {
  return fakeBackend({ 'GET /status': status(), 'GET /mix': current, 'GET /vibes': [] });
}

async function settle() {
  await screen.findByRole('navigation', { name: 'Main' });
  // the startup read of the mix is what decides; give it time to land
  await new Promise((done) => setTimeout(done, 300));
}

const current = () => within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { current: 'page' });

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('EX-0115-03 contextual entry', () => {
  it('idle: the front door opens Make a Mix and stays there', async () => {
    backend();
    render(<App />);
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(current()).toHaveAccessibleName(/Make a Mix/);
  });

  it('paused mid-song: the front door returns to Listen, replacing rather than adding to Back, without playing', async () => {
    const play = vi.spyOn(SetPlayer.prototype, 'playFrom');
    saveResume({ songId: 2, position: 1, time: 40 });
    const before = window.history.length;
    backend();
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/listen'));
    expect(window.history.length).toBe(before);
    expect(current()).toHaveAccessibleName(/Listen/);
    expect(play).not.toHaveBeenCalled();
  });

  it('a deep link wins over where the listener left off', async () => {
    saveResume({ songId: 2, position: 1, time: 40 });
    window.history.pushState({}, '', '/library?q=night');
    backend();
    render(<App />);
    await settle();
    expect(window.location.pathname).toBe('/library');
    expect(window.location.search).toBe('?q=night');
  });

  it('a remembered place in a mix that has since changed is not trusted', async () => {
    saveResume({ songId: 99, position: 1, time: 40 });
    backend();
    render(<App />);
    await settle();
    expect(window.location.pathname).toBe('/');
  });

  it('an empty library opens setup, not Listen, even with a remembered place', async () => {
    saveResume({ songId: 2, position: 1, time: 40 });
    fakeBackend({
      'GET /status': status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, lyrics: 0 } }),
      'GET /mix': { mix: [], name: 'Your mix', can_undo: false },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Where’s your music?' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
