import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../test/backend';
import { Requests } from './Requests';

describe('song requests', () => {
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
