import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';

/**
 * ADR-0069 (S3-0069-06): React StrictMode mounts, unmounts and mounts again in development. That must
 * not leave a second sound source behind: nothing makes an AudioContext or an audio element until the
 * listener presses Play, and swapping between the phone and desk layouts adds none either.
 */

function phone(start: boolean) {
  const lists = new Set<(event: MediaQueryListEvent) => void>();
  let matches = start;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return matches; },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => lists.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => lists.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
  return (next: boolean) => {
    matches = next;
    for (const listener of lists) listener({ matches: next } as MediaQueryListEvent);
  };
}

let contexts = 0;
beforeEach(() => {
  clearToasts();
  contexts = 0;
  window.history.pushState({}, '', '/listen');
  vi.stubGlobal('AudioContext', class {
    constructor() { contexts += 1; }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('S3-0069-06 StrictMode and layout swaps', () => {
  it('a StrictMode mount and a layout swap make no AudioContext and no audio element before Play', async () => {
    fakeBackend({
      'GET /status': status(),
      'GET /mix': { mix: songs(seam('ready', 'a'), seam('ready', 'b')), name: 'Test mix', can_undo: false },
      'GET /vibes': [],
    });
    render(<StrictMode><App /></StrictMode>);
    within(await screen.findByRole('navigation', { name: 'Main' }));
    expect(contexts).toBe(0);
    expect(document.querySelectorAll('audio')).toHaveLength(0);

    for (const width of [375, 1440, 375]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.dispatchEvent(new Event('resize'));
    }
    expect(contexts).toBe(0);
    expect(document.querySelectorAll('audio')).toHaveLength(0);
  });
});

describe('one transport under StrictMode and responsive swaps', () => {
  it('every press reaches the same player, and no audio element or context is added', async () => {
    fakeBackend({
      'GET /status': status(),
      'GET /mix': { mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: false },
      'GET /vibes': [],
      'GET /requests': { requests: [] },
      'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
    });
    const swap = phone(false);
    const owners: SetPlayer[] = [];
    vi.spyOn(SetPlayer.prototype, 'togglePause').mockImplementation(async function (this: SetPlayer) {
      owners.push(this);
    });
    vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});

    render(<StrictMode><App /></StrictMode>);
    const links = within(await screen.findByRole('navigation', { name: 'Main' }));
    // wait for the mix to arrive, so Space has something to play
    await waitFor(async () => {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
      expect(owners.length).toBeGreaterThan(0);
    });

    for (const place of ['Library', 'Workspace', 'Listen']) {
      fireEvent.click(links.getByRole('link', { name: place }));
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    }
    act(() => swap(true));
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    act(() => swap(false));
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });

    expect(owners.length).toBeGreaterThanOrEqual(6);
    expect(new Set(owners).size).toBe(1);
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    expect(contexts).toBe(0);
  });
});
