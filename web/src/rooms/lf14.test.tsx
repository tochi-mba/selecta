import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomPanel } from './RoomPanel';

const stageItem = (stage: string) => ({
  request_id: 'req-1', song: { song_id: 3, title: 'Synthetic Tune', artist: 'Artist', length_s: 180 },
  status: 'accepted', stage, nickname: 'Quiet Otter', votes: 1,
});

function panel(override: Record<string, unknown> = {}) {
  return {
    room: {
      id: 'r-1', name: 'Venue', status: 'open', ends_at: 1800001000,
      settings: {
        join_mode: 'anyone', request_mode: 'approve', votes: true,
        names_shown: false, display: false, zone_id: 'front', clean_only: false,
      },
    },
    code: 'ABCD-EFGH', join_path: '/r/ABCDEFGH', guests: [],
    inbox: [], coming_up: [stageItem('deferred')], unfit: [], renders_left: 10,
    music_paused: true, local_first: true, displays: 0, screens: [], now: 1800000000,
    ...override,
  };
}

describe('LF14 device-owned room UX', () => {
  it('says acceptance is not local playback when the zone speaker is offline', async () => {
    const api = vi.fn(async () => ({ room: panel() }));
    render(<RoomPanel api={api} workspaceId="ws-1" />);
    expect(await screen.findByText(/local venue speaker is offline or not verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Local speaker zone: front/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Accepted guest requests' })).toBeInTheDocument();
    expect(screen.getByText(/Deferred · speaker or recording unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Coming up' })).not.toBeInTheDocument();
  });

  it('sends clean-only setting without changing the bound zone', async () => {
    const api = vi.fn(async (path: string) =>
      path === '/rooms/current' ? { room: panel() } : panel());
    render(<RoomPanel api={api} workspaceId="ws-1" />);
    const checkbox = await screen.findByRole('checkbox', { name: /Clean recordings only/ });
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/rooms/r-1/settings', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ clean_only: true }),
      }), 'ws-1');
    });
  });

  it('includes selected zone in opening a room, without needing audio uploads', async () => {
    const api = vi.fn(async (path: string) =>
      path === '/rooms/current' ? { room: null } : panel());
    render(<RoomPanel api={api} workspaceId="ws-1" zoneId="front" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open room' }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/rooms', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ name: 'Party', settings: { zone_id: 'front' } }),
      }), 'ws-1');
    });
  });
});
