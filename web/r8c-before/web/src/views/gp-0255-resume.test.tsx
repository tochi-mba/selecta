import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftList, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs } from '../test/backend';
import { selectedInEditor } from './Mix';
import { MyMixes, transitionsWaiting } from './MyMixes';

/** GP-0255-01: what "Continue working" can return to, and where each part's authority comes from.
 * The browser keeps only a draft ID and its song order. Transitions that still need you are worked out
 * from the server's copy each time, and opening one is handed to the editor in memory, never stored. */

const KEY = 'selecta.recentDraft';
const list: DraftList = {
  drafts: [{ id: 5, name: 'Friday', songs: 4, seconds: 600, seams: 3, ready: 1, failed: 1, waiting: 1, rendering: false, place: null, eta: null } as never],
  current: { name: 'Current', songs: 0, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
  out_of_room: false,
} as DraftList;
const friday: MixItem[] = songs(seam('ready', 'a'), seam('failed', 'b'), seam('none', 'c'));

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('GP-0255-01 the objects a return can reach', () => {
  it('finds the transitions that still need someone, by the exact occurrences they join', () => {
    expect(transitionsWaiting(friday)).toEqual([
      { a: '2#0', b: '3#0', from: 'Song 2', into: 'Song 3', why: 'it couldn’t be made' },
      { a: '3#0', b: '4#0', from: 'Song 3', into: 'Song 4', why: 'it hasn’t been rendered yet' },
    ]);
    const timing = songs({ ...seam('ready', 'a'), too_soon: true });
    expect(transitionsWaiting(timing)[0].why).toBe('its timing needs fixing');
  });

  it('opens the editor on that exact transition, without storing it in the browser', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ id: 5, order: '1,2,3,4' }));
    fakeBackend({ 'GET /drafts': list, 'GET /mix': { mix: friday, name: 'Friday', can_undo: false } });
    const player = new SetPlayer(() => [], () => {});
    const openDraft = vi.fn();
    render(
      <MyMixes mix={[]} mixName="Current" now={player.state} player={player} canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}} status={undefined as never}
        stage={false} toggleStage={() => {}} openDraft={openDraft} playDraft={vi.fn(async () => {})} setView={vi.fn()} notify={vi.fn()} />,
    );
    const region = await screen.findByRole('region', { name: 'Continue working' });
    expect(within(region).getByText(/Song 2 into Song 3: it couldn’t be made\./)).toBeInTheDocument();
    expect(within(region).getByText(/Song 3 into Song 4: it hasn’t been rendered yet\./)).toBeInTheDocument();

    fireEvent.click(within(region).getByRole('button', { name: 'Open the transition from Song 2 into Song 3' }));
    await waitFor(() => expect(openDraft).toHaveBeenCalledWith(5));
    expect(selectedInEditor(player, 'draft:5')).toEqual({ kind: 'seam', a: '2#0', b: '3#0', from: 'Song 2', into: 'Song 3' });
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ id: 5, order: '1,2,3,4' });
  });
});
