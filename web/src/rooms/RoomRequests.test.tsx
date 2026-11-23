// An accepted room request whose row has not reached the browser's own Requests list: "Getting
// ready" is a short state, the list is re-asked with a backoff, and after ten seconds the row
// says plainly that it cannot be added here yet, with Try now and Dismiss. The counts only count
// what the host can act on.
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestRow, Stage } from '../views/Requests';
import { NOT_HERE_YET, RoomRequests, type RoomRequestsMix } from './RoomRequests';
import { addable, noteRoom, type RoomAsk } from './useRoomSession';

const ask = (id: string, songId: number, title: string): RoomAsk => ({ request_id: id, song: { song_id: songId, title, artist: 'Asake' } as RoomAsk['song'], nickname: 'Calm Hedgehog', votes: 1 });
const row = (id: string, songId: number, title: string): { request: RequestRow; stage: Stage } => ({
  request: { id: 7, song_id: songId, title, artist: 'Asake', status: 'waiting', available: 1, stage: 'searching', room_name: 'Friday room', room_request_id: id } as RequestRow,
  stage: 'searching',
});
const room = (coming: RoomAsk[]) => noteRoom({ room: { id: 'room-1', name: 'Friday room' }, code: 'ABCD-EFGH', inbox: [], coming_up: coming });

function draw(rows: { request: RequestRow; stage: Stage }[] | null) {
  const onMissing = vi.fn();
  const pass = vi.fn(async () => undefined);
  const mixOf = (list: typeof rows): RoomRequestsMix => ({ rows: list, live: false, onAdd: vi.fn(async () => undefined), onDismiss: vi.fn(async () => undefined), onStart: vi.fn(async () => undefined), inMix: () => false });
  const control = { approve: vi.fn(async () => undefined), pass } as never;
  const view = render(<RoomRequests variant="drawer" mix={mixOf(rows)} control={control} onMissing={onMissing} />);
  const redraw = (list: typeof rows) => view.rerender(<RoomRequests variant="drawer" mix={mixOf(list)} control={control} onMissing={onMissing} />);
  return { onMissing, pass, redraw };
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { act(() => noteRoom(null)); vi.useRealTimers(); });

describe('an accepted request the browser list does not hold yet', () => {
  it('says Getting ready at first, and asks for the list again at once', async () => {
    act(() => room([ask('r1', 5, 'Forgiveness')]));
    const { onMissing } = draw([]);
    expect(screen.getByText(/Getting ready/)).toBeInTheDocument();
    expect(screen.queryByText(NOT_HERE_YET)).toBeNull();
    await wait(0);
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('backs off: at once, then after 2, 4, 4, 8, 16 and 30 seconds, then every 30', async () => {
    act(() => room([ask('r1', 5, 'Forgiveness')]));
    const { onMissing } = draw([]);
    const expected = [[0, 1], [2000, 2], [4000, 3], [4000, 4], [8000, 5], [16_000, 6], [30_000, 7], [30_000, 8]];
    for (const [ms, calls] of expected) {
      await wait(ms);
      expect(onMissing).toHaveBeenCalledTimes(calls);
    }
    // never faster than that: 29 seconds later nothing more was asked
    await wait(29_000);
    expect(onMissing).toHaveBeenCalledTimes(8);
  });

  it('after ten seconds says plainly it cannot be added here yet, with Try now and Dismiss', async () => {
    act(() => room([ask('r1', 5, 'Forgiveness')]));
    const { onMissing, pass } = draw([]);
    await wait(0);
    await wait(2000);
    await wait(4000);
    expect(screen.getByText(/Getting ready/)).toBeInTheDocument();
    await wait(4000);
    expect(screen.queryByText(/Getting ready/)).toBeNull();
    expect(screen.getByText(NOT_HERE_YET)).toBeInTheDocument();
    const asked = onMissing.mock.calls.length;
    await act(async () => { screen.getByRole('button', { name: 'Try now: Forgiveness' }).click(); });
    expect(onMissing).toHaveBeenCalledTimes(asked + 1);
    await act(async () => { screen.getByRole('button', { name: 'Dismiss: Forgiveness' }).click(); });
    expect(pass).toHaveBeenCalledWith('r1');
  });

  it('offers Add to mix the moment the row arrives, and stops asking', async () => {
    act(() => room([ask('r1', 5, 'Forgiveness')]));
    const { onMissing, redraw } = draw([]);
    await wait(0);
    await wait(2000);
    await wait(4000);
    await wait(4000);
    expect(screen.getByText(NOT_HERE_YET)).toBeInTheDocument();
    redraw([row('r1', 5, 'Forgiveness')]);
    expect(screen.queryByText(NOT_HERE_YET)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to mix: Forgiveness' })).toBeInTheDocument();
    const asked = onMissing.mock.calls.length;
    await wait(60_000);
    expect(onMissing).toHaveBeenCalledTimes(asked);
  });

  it('counts only the requests that can be added in "Ready to add"', async () => {
    act(() => room([ask('r1', 5, 'Forgiveness'), ask('r2', 6, 'ALAYE')]));
    draw([row('r1', 5, 'Forgiveness')]);
    const group = screen.getByRole('region', { name: 'Ready to add, 1' });
    expect(within(group).getAllByTestId('room-ask')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: 'Add to mix: Forgiveness' })).toBeInTheDocument();
    expect(within(group).getByText(/Getting ready/)).toBeInTheDocument();
  });
});

describe('how many requests can be added', () => {
  const coming = [{ request_id: 'r1' }, { request_id: 'r2' }];

  it('counts a request as ready once the browser list holds its row', () => {
    expect(addable(coming, [{ room_request_id: 'r1' }])).toEqual({ ready: 1, onTheWay: 1 });
    expect(addable(coming, [{ room_request_id: 'r1' }, { room_request_id: 'r2' }, {}])).toEqual({ ready: 2, onTheWay: 0 });
    expect(addable(coming, [])).toEqual({ ready: 0, onTheWay: 2 });
  });

  it('takes the room at its word while the list has not loaded', () => {
    expect(addable(coming, null)).toEqual({ ready: 2, onTheWay: 0 });
    expect(addable(coming, undefined)).toEqual({ ready: 2, onTheWay: 0 });
  });
});
