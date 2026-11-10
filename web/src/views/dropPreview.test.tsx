import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { affectedSeams, newNeighbours } from './dropPreview';
import { Mix } from './Mix';

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player}
      now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

const five = () => songs(seam('ready', 'a'), seam('ready', 'b'), seam('ready', 'c'), seam('ready', 'd'));
const row = (title: string) => screen.getByRole('button', { name: `Reorder ${title}` }).closest('li')!;
const carried = { types: ['application/x-selecta-song-position'], setData: () => {}, getData: () => '', setDragImage: () => {}, effectAllowed: '', dropEffect: '' };
const marked = (container: HTMLElement) => [...container.querySelectorAll('li.seam')].map((seamRow) => seamRow.hasAttribute('data-drop-affected'));

afterEach(() => setFlags(null));

describe('CI-0173-02 the seams a drop would change', () => {
  it('names only the two seams around the song and the one it lands in', () => {
    // seam i joins song i-1 into song i
    expect(affectedSeams(1, 3, 5)).toEqual([1, 2, 4]);
    expect(affectedSeams(3, 1, 5)).toEqual([1, 3, 4]);
    expect(affectedSeams(2, 1, 5)).toEqual([1, 2, 3]);
    expect(affectedSeams(0, 4, 5)).toEqual([1]);
    expect(affectedSeams(4, 0, 5)).toEqual([4]);
    expect(affectedSeams(2, 2, 5)).toEqual([]);
    expect(affectedSeams(-1, 2, 5)).toEqual([]);
    expect(affectedSeams(1, 9, 5)).toEqual([]);
  });

  it('works out the new neighbours from the move the editor will really make', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(newNeighbours(items, 1, 3)).toEqual({ before: 'd', after: 'e' });
    expect(newNeighbours(items, 3, 0)).toEqual({ before: undefined, after: 'a' });
    expect(newNeighbours(items, 0, 4)).toEqual({ before: 'e', after: undefined });
    expect(newNeighbours(items, 2, 2)).toEqual({});
  });

  it('marks the affected transitions and says where the song lands, before anything moves', () => {
    const calls = fakeBackend({});
    const { container } = render(<Harness start={five()} />);
    fireEvent.dragStart(row('Song 2').querySelector('[data-handle]')!, { dataTransfer: carried });
    fireEvent.dragOver(row('Song 4'), { dataTransfer: carried });
    expect(marked(container)).toEqual([true, true, false, true]);
    expect(screen.getByText(/Dropping Song 2/)).toHaveTextContent('Dropping Song 2 here puts it between Song 4 and Song 5. 3 transitions change.');
    expect(screen.getByText(/Dropping Song 2/)).toHaveAttribute('role', 'status');
    expect(container.querySelectorAll('.drop-affected-note')).toHaveLength(3);
    expect(calls.some((call) => call.path === '/mix/move')).toBe(false);

    fireEvent.dragEnd(row('Song 2'), { dataTransfer: carried });
    expect(marked(container)).toEqual([false, false, false, false]);
    expect(screen.queryByText(/Dropping Song 2/)).toBeNull();
  });

  it('marks nothing over the song being carried, and nothing when the preview is turned off', () => {
    fakeBackend({});
    const { container, unmount } = render(<Harness start={five()} />);
    fireEvent.dragStart(row('Song 3').querySelector('[data-handle]')!, { dataTransfer: carried });
    fireEvent.dragOver(row('Song 3'), { dataTransfer: carried });
    expect(marked(container)).toEqual([false, false, false, false]);
    unmount();

    setFlags({ 'editor.drag_preview': false });
    const off = render(<Harness start={five()} />);
    fireEvent.dragStart(row('Song 2').querySelector('[data-handle]')!, { dataTransfer: carried });
    fireEvent.dragOver(row('Song 4'), { dataTransfer: carried });
    expect(marked(off.container)).toEqual([false, false, false, false]);
    expect(row('Song 4')).toHaveClass('over');
    expect(screen.queryByText(/Dropping Song 2/)).toBeNull();
  });
});
