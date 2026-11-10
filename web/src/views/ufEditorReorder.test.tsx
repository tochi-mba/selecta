import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/** UF-0380-03: reordering works without a pointer. The handle moves a song with the arrow keys and the
 * Move up/down buttons do the same; focus stays on the moved song and every move can be undone. */

function Harness({ start, notify }: { start: MixItem[]; notify: (message: string, undo?: unknown) => void }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={notify as never} stage={false} toggleStage={() => {}} />
  );
}

const ready = (key: string) => seam('ready', key, { label: 'Blend', style: 'bass_swap_blend' });
const start = songs(ready('a'), ready('b'));
/** the server's answer to a move (the first song never has a transition into it): the same occurrences in the new order */
const moved = (from: number, to: number): MixData => {
  const order = [...start];
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return { mix: order.map((song, position) => ({ ...song, position, seam: position === 0 ? null : song.seam ?? ready(`n${position}`) })), name: 'Test mix', can_undo: true } as unknown as MixData;
};
const titles = () => [...document.querySelectorAll('li.song[data-song-key]')].map((row) => row.querySelector('.song-select')?.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('UF-0380-03 reorder alternatives', () => {
  it('moves a song up with the keyboard handle, keeps focus on it, and offers Undo', async () => {
    const notify = vi.fn();
    const calls = fakeBackend({ 'POST /mix/move': moved(2, 1) });
    render(<Harness start={start} notify={notify} />);
    const handle = screen.getByRole('button', { name: 'Reorder Song 3' });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 3', 'Song 2']));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ source: 2, target: 1 });
    expect(notify).toHaveBeenCalledWith('Moved that song.', true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder Song 3' })));
  });

  it('moves a song with the Move up button and keeps focus on that song’s own button', async () => {
    const notify = vi.fn();
    const calls = fakeBackend({ 'POST /mix/move': moved(1, 0) });
    render(<Harness start={start} notify={notify} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Song 2 up' }));
    await waitFor(() => expect(titles()).toEqual(['Song 2', 'Song 1', 'Song 3']));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ source: 1, target: 0 });
    expect(notify).toHaveBeenCalledWith('Moved Song 2 up.', true);
    // at the top it can't go further up, so focus lands on its handle rather than a disabled button
    await waitFor(() => expect(document.activeElement?.closest('li')?.querySelector('.song-select')?.textContent).toBe('Song 2'));
  });
});
