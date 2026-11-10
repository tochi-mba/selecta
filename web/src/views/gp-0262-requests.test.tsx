import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../test/backend';
import { Requests } from './Requests';

/** GP-0262-03: a request keeps the exact recording that was picked. Two recordings with the same
 * title and artist are told apart by song number, and the one asked for is the one sent and listed. */

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
