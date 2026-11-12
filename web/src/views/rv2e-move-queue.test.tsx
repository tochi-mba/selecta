import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { MixData } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';
import { draftMovesWaiting, movedLocally, MoveQueue } from './optimisticMove';

/** rv2-e: MoveQueue under overlapping moves, held server answers and a refresh from another draft. */

const draft = (id: number, mix = songs(seam('ready', 'a'), seam('ready', 'b'), seam('ready', 'c'))): MixData => (
  { mix, name: `Draft ${id}`, can_undo: true, draft: { id, place: null } }
);
const order = (data: MixData) => data.mix.map((item) => item.song_id).join(',');

/** A send whose answers the test hands out one at a time. */
function held() {
  const asked: { order: string; settle: (answer: MixData | Error) => void }[] = [];
  const send = (order: string) => new Promise<MixData>((done, fail) => {
    asked.push({ order, settle: (answer) => (answer instanceof Error ? fail(answer) : done(answer)) });
  });
  return { asked, send };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

describe('rv2-e MoveQueue with overlapping moves', () => {
  it('sends moves one at a time, in the order they were made, each guarded by the confirmed order', async () => {
    const queue = new MoveQueue();
    const start = draft(9);
    const a = movedLocally(start.mix, 3, 2);
    const b = movedLocally(a, 2, 1);
    const server = held();
    const first = queue.add(start, server.send);
    const second = queue.add({ ...start, mix: a }, server.send);
    await flush();
    expect(server.asked.map((ask) => ask.order)).toEqual(['1,2,3,4']);
    server.asked[0].settle({ ...start, mix: a });
    expect(await first).toMatchObject({ kind: 'saved', last: false });
    await flush();
    expect(server.asked.map((ask) => ask.order)).toEqual(['1,2,3,4', '1,2,4,3']);
    server.asked[1].settle({ ...start, mix: b });
    const done = await second;
    expect(done).toMatchObject({ kind: 'saved', last: true });
    expect(server.asked).toHaveLength(2);
    expect(queue.busy).toBe(false);
    expect(draftMovesWaiting()).toBe(false);
  });

  it('rolls back to the last confirmed order, keeping saved moves and dropping the ones on top', async () => {
    const queue = new MoveQueue();
    const start = draft(9);
    const a = movedLocally(start.mix, 3, 2);
    const b = movedLocally(a, 2, 1);
    const server = held();
    const one = queue.add(start, server.send);
    const two = queue.add({ ...start, mix: a }, server.send);
    const three = queue.add({ ...start, mix: b }, server.send);
    await flush();
    server.asked[0].settle({ ...start, mix: a });
    await flush();
    server.asked[1].settle(new Error('mix_changed'));
    const refused = await two;
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') expect(order(refused.restore)).toBe('1,2,4,3');
    expect(await one).toMatchObject({ kind: 'saved', last: false });
    expect(await three).toEqual({ kind: 'dropped', last: true });
    expect(server.asked).toHaveLength(2);
    // a move made after the rollback is sent, against the restored order
    const four = queue.add(refused.kind === 'refused' ? refused.restore : start, server.send);
    await flush();
    expect(server.asked[2].order).toBe('1,2,4,3');
    server.asked[2].settle(start);
    expect(await four).toMatchObject({ kind: 'saved', last: true });
    expect(draftMovesWaiting()).toBe(false);
  });
});

describe('rv2-e a draft move on its way in one draft', () => {
  let release: (() => void) | null = null;
  beforeEach(() => {
    clearToasts();
    window.localStorage.clear();
    vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
  });
  afterEach(async () => {
    release?.();
    release = null;
    vi.useRealTimers();
    await vi.waitFor(() => expect(draftMovesWaiting()).toBe(false));
  });

  it('does not hold back the poll of another draft that is open and rendering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // draft 7 is rendering, so the app polls it every two seconds
    let friday: MixData = { ...draft(7, songs(seam('rendering', 'b'))), name: 'Friday' };
    window.history.pushState({}, '', '/mixes/drafts/7/edit');
    fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': { drafts: [], current: { name: 'Current', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
      'GET /mix': (_body: unknown, url: string) => (url.includes('draft=7') ? friday : { mix: songs(seam('ready', 'a')), name: 'Current', can_undo: false }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Friday' }, { timeout: 3000 })).toBeInTheDocument();
    // a move in draft 3 (left open a moment ago) that the server has not answered; mutations have no deadline
    const other = new MoveQueue();
    const shown = draft(3, []);
    void other.add(shown, () => new Promise((done) => { release = () => done(shown); }));
    // the server renames draft 7 meanwhile; its next poll should show that
    friday = { ...friday, name: 'Friday late' };
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(await screen.findByRole('heading', { name: 'Friday late' }, { timeout: 2000 })).toBeInTheDocument();
  });
});
