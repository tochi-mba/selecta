import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { LANES, Shape, SIDES } from '../studio';
import { Studio } from './Studio';

/** UF-0382-02: every Studio cell is two bars, and the grid and the list name the same bar range for the
 * same cell at 8, 32 and 64 cells. */

vi.mock('../studio', async (actual) => {
  const real = await actual<typeof import('../studio')>();
  return {
    ...real,
    StemDeck: class {
      setShape = vi.fn(); play = vi.fn(async () => {}); stop = vi.fn(); solo = vi.fn(); close = vi.fn();
      load = vi.fn(async () => undefined);
      onCell: (cell: number) => void = () => {};
    },
  };
});

const empty = (cells: number): Shape => {
  const shape = {} as Shape;
  for (const side of SIDES) {
    shape[side] = {} as Shape['a'];
    for (const lane of LANES) shape[side][lane] = Array.from({ length: cells }, () => 0);
  }
  return shape;
};

afterEach(() => vi.unstubAllGlobals());

describe.each([8, 32, 64])('UF-0382-02 time boundaries at %i cells', (cells) => {
  afterEach(() => window.localStorage.removeItem(`selecta.studio.uf382-${cells}`));

  it('says each square is 2 bars and labels the first and last cells with the same ranges in grid and list', async () => {
    fakeBackend({ 'POST /mix/1/studio': { status: 'ready', key: `uf382-${cells}`, bars: cells * 2, cells, seconds: cells * 4, start_shape: empty(cells), shape: null } });
    const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } } as never);
    render(<Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} notify={() => {}} />);
    expect(await screen.findByText(/Each square is 2 bars in that song/)).toBeInTheDocument();
    const last = `bars ${cells * 2 - 1}–${cells * 2}`;
    const grid = screen.getAllByRole('button').filter((button) => button.classList.contains('studio-cell'));
    expect(grid).toHaveLength(cells * 8);
    expect(grid[0]).toHaveAccessibleName('Song 1 voice, bars 1–2, off');
    expect(grid[cells - 1]).toHaveAccessibleName(`Song 1 voice, ${last}, off`);
    expect(grid[grid.length - 1]).toHaveAccessibleName(`Song 2 melody, ${last}, off`);
    fireEvent.click(screen.getByRole('button', { name: 'Detailed list' }));
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(cells * 8);
    expect(boxes[0]).toHaveAccessibleName('bars 1–2');
    expect(boxes[cells - 1]).toHaveAccessibleName(last);
    expect(boxes[boxes.length - 1]).toHaveAccessibleName(last);
  });
});
