import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { SetPlayer } from './player';
import { clearToasts } from './ui/toasts';
import { fakeBackend, Reply, seam, songs, status } from './test/backend';

/**
 * S4-0099-05: a draft that fails to become the current mix leaves the current mix and its audio
 * exactly as they were. A server error and a change made in another tab both keep the listener on
 * My Mixes, never start the draft, and say what went wrong.
 */
const list = (drafts: { id: number; name: string }[]) => ({
  drafts: drafts.map((draft) => ({ songs: 2, seconds: 400, seams: 1, ready: 0, failed: 0, waiting: 1, rendering: false, place: null, eta: null, to_render: 60, missing: 0, ...draft })),
  current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
  out_of_room: false,
});
const current = { mix: songs(seam('ready', 'a')), name: 'Current', can_undo: false };
const friday = { mix: songs(seam('none', 'b')), name: 'Friday', can_undo: true, draft: { id: 7, place: null } };

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  window.history.pushState({}, '', '/mixes/mine');
});

async function startPlayingCurrent() {
  const playFrom = vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
  vi.spyOn(SetPlayer.prototype, 'togglePause').mockImplementation(async function (this: SetPlayer) {
    this.state = { ...this.state, phase: 'playing' };
    this.onChange(this.state);
  });
  render(<App />);
  const currentArea = within(await screen.findByRole('region', { name: 'Current mix' }));
  fireEvent.click(currentArea.getByRole('button', { name: 'Play' }));
  await waitFor(() => expect(window.location.pathname).toBe('/listen'));
  window.history.pushState({}, '', '/mixes/mine');
  fireEvent.popState(window);
  return playFrom;
}

describe('S4-0099-05 failed activation keeps the current mix and audio', () => {
  it.each([
    ['a server error', new Reply(500, { detail: 'The server could not switch mixes.' }), /could not switch mixes/],
    ['a change in another tab', new Reply(409, { detail: 'The mix changed in another tab.', code: 'mix_changed' }), /changed in another tab/],
  ])('%s while replacing leaves Current playing and stays on My Mixes', async (_name, failure, message) => {
    let mixReads = 0;
    const calls = fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': list([{ id: 7, name: 'Friday' }]),
      'GET /mix': (_body: unknown, url: string) => {
        if (url.includes('draft=7')) return friday;
        mixReads += 1;
        return current;
      },
      'POST /drafts/7/play': failure,
    });
    const playFrom = await startPlayingCurrent();
    const startsBefore = playFrom.mock.calls.length;
    const readsBefore = mixReads;

    fireEvent.click(await screen.findByRole('button', { name: 'Play Friday' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace with draft' }));
    await waitFor(() => expect(calls.filter((call) => call.path === '/drafts/7/play')).toHaveLength(1));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/mixes/mine');
    // the draft never started, and what was playing was never stopped or restarted
    expect(playFrom.mock.calls.length).toBe(startsBefore);
    expect(SetPlayer.prototype.togglePause).toHaveBeenCalledOnce();
    expect(screen.queryByText(/What was playing is kept in your drafts/)).toBeNull();
    // still the current mix the listener chose to keep
    expect(within(screen.getByRole('region', { name: 'Current mix' })).getByText('Current')).toBeInTheDocument();
    if (/another tab/.test(String(message))) expect(mixReads).toBeGreaterThan(readsBefore);
  });
});
