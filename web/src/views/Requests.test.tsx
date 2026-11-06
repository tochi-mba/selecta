import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { SetPlayer } from '../player';
import { Requests } from './Requests';

describe('song requests', () => {
  it('uses the fresh playhead before automatically inserting a ready request', async () => {
    const state = { phase: 'playing', position: 0, duration: 200, songTime: 20, inSeam: false };
    const mix = songs(undefined, undefined, undefined);
    const onMix = vi.fn();
    const calls = fakeBackend({
      'GET /requests': { requests: [] },
      'POST /requests/consider': () => {
        state.position = 1;
        return { requests: [{ id: 7, song_id: 9, title: 'Wanted', available: 1, ready: true, offer: 'prepared' }] };
      },
      'POST /requests/insert': { mix, name: 'Mix', can_undo: true },
    });
    render(<Requests playback={{ mix, player: { state } as SetPlayer, onMix }} />);
    expect(await screen.findByText('Wanted has joined the mix ahead of playback.')).toBeInTheDocument();
    expect(onMix).toHaveBeenCalledOnce();
    expect(calls.find(call => call.path === '/requests/insert')?.body).toMatchObject({ position: 1, offer: 'prepared' });
  });

  it('shows saved requests and cancels without editing the mix', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [{ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', available: 1 }] },
      'DELETE /requests/7': { requests: [] },
    });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(await screen.findByText('No requests waiting.')).toBeInTheDocument();
    expect(calls.some(call => call.path.startsWith('/mix'))).toBe(false);
  });

  it('keeps requests visible when cancellation fails', async () => {
    fakeBackend({ 'GET /requests': { requests: [{ id: 7, song_id: 9, title: 'Wanted', available: 0 }] } });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not cancel');
    expect(screen.getByText('Wanted')).toBeInTheDocument();
  });
});
