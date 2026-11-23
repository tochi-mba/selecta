// The Requests drawer in Cloud in the browser (BrowserRequests.tsx): one short Waiting list, each
// row saying who asked and in which room, with one thing to do (Add next while a mix plays, Add to
// mix otherwise, or Start a mix with this song when there is no mix) and Dismiss.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type MixData } from '../api';
import { JOINS_BY_HAND } from '../cloud/localFirstRequests';
import type { PlayerLike } from '../playerContract';
import { BrowserRequests } from './BrowserRequests';
import type { RequestRow, Stage } from './Requests';

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  id: 7, song_id: 42, title: 'Flux', artist: 'Ellie Goulding', stage: 'searching', browser_note: 'Waiting for you to add it.',
  room_name: 'Friday room', asked_by: 'Mia', ...over,
} as RequestRow);

function draw(rows: { request: RequestRow; stage: Stage }[], options: {
  live?: boolean; send?: ReturnType<typeof vi.fn>; refresh?: () => Promise<void>;
  playFrom?: ReturnType<typeof vi.fn>; onMix?: ReturnType<typeof vi.fn>;
} = {}) {
  const onAdd = vi.fn(async () => undefined);
  const onDismiss = vi.fn();
  const send = options.send ?? vi.fn(async () => ({}));
  const player = { playFrom: options.playFrom ?? vi.fn(async () => undefined) } as unknown as PlayerLike;
  const onMix = options.onMix ?? vi.fn();
  render(
    <BrowserRequests rows={rows} live={options.live ?? false} playback={{ mix: [], player, onMix: onMix as (data: MixData) => void }}
      send={send as never} refresh={options.refresh} onAdd={onAdd} onDismiss={onDismiss} />,
  );
  return { onAdd, onDismiss, send, player, onMix };
}

describe('the browser Requests list', () => {
  it('says who asked in which room, and offers Add next while a mix plays', async () => {
    const request = row();
    const { onAdd } = draw([{ request, stage: 'searching' }], { live: true });
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeInTheDocument();
    expect(screen.getByText(JOINS_BY_HAND)).toBeInTheDocument();
    expect(screen.getByText('Asked by Mia in Friday room')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add next: Flux' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(request));
  });

  it('offers Add to mix when nothing is playing, and a guest with no name is "a guest"', () => {
    draw([{ request: row({ asked_by: null }), stage: 'searching' }]);
    expect(screen.getByRole('button', { name: 'Add to mix: Flux' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add next/ })).toBeNull();
    expect(screen.getByText('Asked by a guest in Friday room')).toBeInTheDocument();
  });

  it('says nothing about who asked for the member’s own request', () => {
    draw([{ request: row({ room_name: undefined, asked_by: undefined }), stage: 'searching' }]);
    expect(screen.queryByText(/Asked by/)).toBeNull();
  });

  it('dismisses a request', () => {
    const request = row();
    const { onDismiss } = draw([{ request, stage: 'searching' }], { live: true });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Flux' }));
    expect(onDismiss).toHaveBeenCalledWith(request);
  });

  it('holds back a song already in the mix and says why', () => {
    draw([{ request: row(), stage: 'in_mix' }], { live: true });
    expect(screen.getByText('Already in your mix.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add next/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss: Flux' })).toBeEnabled();
  });

  it('with no mix, starts one that begins with the requested song and plays it', async () => {
    const data = { mix: [{ song_id: 42 }, { song_id: 9 }] } as unknown as MixData;
    const send = vi.fn(async (path: string, _init?: RequestInit) => (path.startsWith('/vibes/pick/build') ? data : {}));
    const refresh = vi.fn(async () => undefined);
    const { player, onMix } = draw([{ request: row(), stage: 'no_mix' }], { send, refresh });
    expect(screen.getByText('No mix is playing yet. Start one with a request and add the others after it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to mix/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start a mix with this song: Flux' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(send.mock.calls[0][0]).toBe('/vibes/pick/build?start=42');
    expect(send.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(onMix).toHaveBeenCalledWith(data);
    expect(player.playFrom).toHaveBeenCalledWith(0);
    const [path, init] = send.mock.calls[1];
    expect(path).toBe('/requests/consider');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ order: [42, 9], position: 0 });
  });

  it('says a mix needs two songs when there are too few to start one', async () => {
    const send = vi.fn(async () => { throw new ApiError('Not enough songs', 409, 'not_enough_songs'); });
    const { player, onMix } = draw([{ request: row(), stage: 'no_mix' }], { send });
    fireEvent.click(screen.getByRole('button', { name: 'Start a mix with this song: Flux' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A mix needs at least two songs that can play on this device.');
    expect(screen.getByRole('link', { name: 'Connect music' })).toHaveAttribute('href', '/library');
    expect(onMix).not.toHaveBeenCalled();
    expect(player.playFrom).not.toHaveBeenCalled();
  });
});
