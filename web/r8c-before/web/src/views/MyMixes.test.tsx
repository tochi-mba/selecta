import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftList, MixData } from '../api';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { fakeBackend, songs } from '../test/backend';
import { MyMixes } from './MyMixes';

/** GP-0255: the optional "Continue working" return to an unfinished draft. It stores only a draft ID
 * and its song order, trusts the server over that, and never starts playback or applies Studio work. */
const KEY = 'selecta.recentDraft';

const drafts = (ids: number[]): DraftList => ({
  drafts: ids.map((id) => ({ id, name: `Draft ${id}`, songs: 3, seconds: 600, seams: 2, ready: 0, failed: 0, waiting: 2, rendering: false, place: null, eta: null, to_render: 0, missing: 0 })),
  current: { name: 'Current', songs: 0, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
  out_of_room: false,
});
const draftMix = (order: number[]): MixData => ({ mix: songs(...order.slice(1).map(() => null)).map((item, index) => ({ ...item, song_id: order[index] })) } as unknown as MixData);

function show(stored: unknown, server: { list: DraftList; order: number[] | 'gone' }) {
  window.localStorage.setItem(KEY, JSON.stringify(stored));
  const calls = fakeBackend({
    'GET /drafts': server.list,
    'GET /mix': () => (server.order === 'gone' ? { mix: [] } : draftMix(server.order)),
  });
  const player = new SetPlayer(() => [], () => {});
  const togglePause = vi.spyOn(player, 'togglePause');
  const playFrom = vi.spyOn(player, 'playFrom');
  const props = { openDraft: vi.fn(), playDraft: vi.fn(async () => {}), setView: vi.fn(), notify: vi.fn() };
  render(
    <MyMixes mix={[]} mixName="Current" now={player.state} player={player} canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}} status={undefined as never}
      stage={false} toggleStage={() => {}} {...props} />,
  );
  return { calls, togglePause, playFrom, ...props };
}

afterEach(() => {
  window.localStorage.clear();
  setFlags(null);
  vi.unstubAllGlobals();
});

describe('GP-0255 continue working', () => {
  it('GP-0255-02/03 offers one quiet way back to the exact draft and order last edited', async () => {
    const { openDraft } = show({ id: 5, order: '1,2,3' }, { list: drafts([4, 5]), order: [1, 2, 3] });
    const region = await screen.findByRole('region', { name: 'Continue working' });
    expect(region).toHaveTextContent('Return to Draft 5 at its last saved song order.');
    expect(screen.getAllByRole('button', { name: 'Continue editing draft' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing draft' }));
    await waitFor(() => expect(openDraft).toHaveBeenCalledWith(5));
  });

  it('GP-0255-04 returning never starts playback', async () => {
    const { togglePause, playFrom, playDraft, openDraft } = show({ id: 5, order: '1,2,3' }, { list: drafts([5]), order: [1, 2, 3] });
    expect(await screen.findByText(/no playback starts and no pending Studio edits are applied/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing draft' }));
    await waitFor(() => expect(openDraft).toHaveBeenCalled());
    expect(togglePause).not.toHaveBeenCalled();
    expect(playFrom).not.toHaveBeenCalled();
    expect(playDraft).not.toHaveBeenCalled();
  });

  it('GP-0255-05 a draft that has gone offers no shortcut and forgets it', async () => {
    const { calls } = show({ id: 9, order: '1,2,3' }, { list: drafts([4]), order: [1, 2, 3] });
    await waitFor(() => expect(calls.some((call) => call.path.startsWith('/mix?draft=9'))).toBe(true));
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
    expect(screen.queryByRole('region', { name: 'Continue working' })).toBeNull();
  });

  it('GP-0255-05 a draft edited elsewhere since is not reopened at a stale order', async () => {
    show({ id: 5, order: '1,2,3' }, { list: drafts([5]), order: [3, 2, 1] });
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Continue editing draft' })).toBeNull();
  });

  it('GP-0255-05 a change between showing the shortcut and pressing it is caught', async () => {
    const server = { list: drafts([5]), order: [1, 2, 3] as number[] | 'gone' };
    const { openDraft } = show({ id: 5, order: '1,2,3' }, server);
    await screen.findByRole('button', { name: 'Continue editing draft' });
    server.order = [2, 1, 3];
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This draft changed since your last visit.');
    expect(openDraft).not.toHaveBeenCalled();
  });

  it('GP-0255-06 stores only an ID and order, ignores anything malformed, and Forget clears it', async () => {
    show({ id: 'x', order: 5, title: 'injected' }, { list: drafts([5]), order: [1] });
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(screen.queryByRole('region', { name: 'Continue working' })).toBeNull();
    vi.unstubAllGlobals();
    cleanup();

    show({ id: 5, order: '1,2,3' }, { list: drafts([5]), order: [1, 2, 3] });
    await screen.findByRole('region', { name: 'Continue working' });
    expect(Object.keys(JSON.parse(window.localStorage.getItem(KEY)!)).sort()).toEqual(['id', 'order']);
    fireEvent.click(screen.getByRole('button', { name: 'Forget shortcut' }));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Continue working' })).toBeNull();
  });

  it('GP-0255-02 is absent when its flag is off, and the page still shows drafts', async () => {
    setFlags({ 'mymixes.continue_working': false });
    show({ id: 5, order: '1,2,3' }, { list: drafts([5]), order: [1, 2, 3] });
    expect(await screen.findByRole('heading', { name: 'My Mixes' })).toBeVisible();
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(screen.queryByRole('region', { name: 'Continue working' })).toBeNull();
  });
});
