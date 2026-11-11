import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, songs } from '../test/backend';
import { ComingSongs, RequestRow, RequestsContext, RequestsPanel, RequestsState, waitingRequestCount, Requests } from './Requests';

/** GP-0262-03: a request keeps the exact recording that was picked. Two recordings with the same
 * title and artist are told apart by song number, and the one asked for is the one sent and listed.
 * GP-0262-06: a request that is only waiting says nothing new on each recheck.
 * GP-0262-07: Listen, the navigation and the Requests panel count and describe one request the same way. */

const found = (id: number, title: string, artist: string) => ({ id, title, artist, genre: null, duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false });

describe('GP-0262-03 the exact requested recording', () => {
  it('same-titled recordings by different artists, or the same artist twice, stay distinct through the request', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [] },
      'GET /songs': [found(10, 'Same Name', 'Hal Greene'), found(11, 'Same Name', 'Iris Vale'), found(12, 'Same Name', 'Iris Vale')],
      'POST /requests': { id: 7, requests: [{ id: 7, song_id: 12, title: 'Same Name', artist: 'Iris Vale', status: 'waiting', available: 1 }] },
    });
    render(<Requests />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Request a song' }), { target: { value: 'same' } });
    const hal = await screen.findByRole('button', { name: /Same Name - Hal Greene/ });
    expect(hal.textContent).not.toMatch(/Song 10/);
    // the two Iris Vale recordings are told apart by their song number
    expect(screen.getByRole('button', { name: /Same Name - Iris Vale \(song 11\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Same Name - Iris Vale \(song 12\)/ }));
    await waitFor(() => expect(calls.find((call) => call.path === '/requests' && call.method === 'POST')?.body).toEqual({ song_id: 12 }));
    const list = within(await screen.findByRole('list', { name: 'Your requests' }));
    expect(list.getByText('Same Name')).toBeInTheDocument();
    expect(list.getByText('Iris Vale')).toBeInTheDocument();
    expect(list.queryByText('Hal Greene')).toBeNull();
  });
});

describe('GP-0262-06 no repeated news while a request only waits', () => {
  it('rechecking a waiting request many times tells the listener nothing until something really happens', async () => {
    const notify = vi.fn();
    let answer: unknown = { requests: [{ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, stage: 'searching' }] };
    const calls = fakeBackend({
      'GET /requests': { requests: [{ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1 }] },
      'POST /requests/consider': () => answer,
    });
    const state = { phase: 'playing', position: 0, duration: 200, songTime: 20, inSeam: false };
    const playback = { mix: songs(undefined, undefined, undefined), player: { state, togglePause: vi.fn(async () => {}) } as unknown as SetPlayer, onMix: vi.fn() };
    const { rerender } = render(<Requests playback={playback} notify={notify} />);
    const considered = () => calls.filter((call) => call.path === '/requests/consider').length;
    await waitFor(() => expect(considered()).toBe(1));
    for (let position = 1; position <= 4; position += 1) {
      state.position = position;
      rerender(<Requests playback={{ ...playback }} notify={notify} />);
      await waitFor(() => expect(considered()).toBe(position + 1));
    }
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    // a real outcome is said once
    answer = { requests: [], settled: ['Wanted'] };
    state.position = 5;
    rerender(<Requests playback={{ ...playback }} notify={notify} />);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith('Wanted is in your mix now, so that request is done.');
  });
});

describe('GP-0262-07 Listen and Requests tell one story', () => {
  const row = (more: Partial<RequestRow> = {}): RequestRow => ({ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, ...more });
  const playing = (phase = 'playing') => ({
    mix: songs(undefined, undefined),
    player: { state: { phase, position: 0, duration: 200, songTime: 20, inSeam: false }, togglePause: vi.fn(async () => {}) } as unknown as SetPlayer,
    onMix: vi.fn(),
  });
  const both = (rows: RequestRow[], phase = 'playing') => {
    const value = { requests: rows, error: '', message: '', playback: playing(phase), add: vi.fn(), cancel: vi.fn(async () => {}), chooseBridge: vi.fn(), addAnyway: vi.fn(), findBridges: vi.fn(), pickBridge: vi.fn() } as unknown as RequestsState;
    return render(
      <RequestsContext.Provider value={value}>
        <RequestsPanel />
        <ol aria-label="Listen timeline"><ComingSongs afterSongId={2} /></ol>
      </RequestsContext.Provider>,
    );
  };

  it('a pick being saved counts the same in the panel, Listen and the navigation', () => {
    const rows = [row(), row({ id: -1, song_id: 10, title: 'Saving', saving: true })];
    expect(waitingRequestCount(rows)).toBe(2);
    expect(waitingRequestCount(null)).toBe(0);
    both(rows);
    // the panel header says the same number the Listen button and navigation are given
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
  });

  it('a request getting ready reads as getting ready in both places, with no play time promised', () => {
    both([row({ stage: 'preparing', after: 'Song 2', after_id: 2, transitions: [{ from: 'Song 2', to: 'Wanted', key: 'k', status: 'rendering' }] })]);
    const panel = within(screen.getByRole('list', { name: 'Your requests' }));
    expect(panel.getByText('Getting ready')).toBeInTheDocument();
    const timeline = within(screen.getByRole('list', { name: 'Listen timeline' }));
    expect(timeline.getByText('0 of 1 ready')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/plays in|queue position|\d+:\d\d/i);
  });

  it('a ready request is ready for an opening in both places, not guaranteed a time', () => {
    both([row({ stage: 'ready', after: 'Song 2', after_id: 2, transitions: [{ from: 'Song 2', to: 'Wanted', key: 'k', status: 'ready' }] })]);
    expect(within(screen.getByRole('list', { name: 'Your requests' })).getByText('Ready for an opening')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Listen timeline' })).getByText('Ready - waiting for a valid opening')).toBeInTheDocument();
  });

  it('a request that is only waiting, or has nothing playing, shows no placement on Listen', () => {
    both([row({ stage: 'searching', after_id: 2 })]);
    expect(within(screen.getByRole('list', { name: 'Your requests' })).getByText('Finding a place')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Listen timeline' })).queryByRole('listitem')).toBeNull();
  });

  it('when playback stops, a placed request goes back to waiting in the panel and leaves the Listen timeline', () => {
    both([row({ stage: 'preparing', after: 'Song 2', after_id: 2 })], 'idle');
    expect(within(screen.getByRole('list', { name: 'Your requests' })).getByText('Requested · waiting')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Listen timeline' })).queryByRole('listitem')).toBeNull();
  });
});
