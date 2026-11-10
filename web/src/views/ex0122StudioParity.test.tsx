import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { LANES, Shape, SIDES } from '../studio';
import { Studio } from './Studio';

/** EX-0122-01, -03 and -04 (Experience programme, Stem Studio): the guided Shape view, the Detailed grid
 * and the Detailed list are three views of one exact working copy at 8, 32 and 64 cells. Switching never
 * translates, normalizes or loses a cell; every lane keeps its solo; presets and Start again still work;
 * and unsaved work survives switches and a reopen without being applied anywhere. */

const deck = vi.hoisted(() => ({
  made: [] as { setShape: ReturnType<typeof vi.fn>; solo: ReturnType<typeof vi.fn> }[],
}));

vi.mock('../studio', async (actual) => {
  const real = await actual<typeof import('../studio')>();
  return {
    ...real,
    StemDeck: class {
      setShape = vi.fn();
      play = vi.fn(async () => {});
      stop = vi.fn();
      solo = vi.fn();
      close = vi.fn();
      load = vi.fn(async () => undefined);
      onCell: (cell: number) => void = () => {};
      constructor() {
        deck.made.push(this);
      }
    },
  };
});

/** A deliberately irregular pattern, so any reordering, resizing or normalizing shows up. */
const pattern = (cells: number): Shape => {
  const lane = (row: number) => Array.from({ length: cells }, (_, column) => ((row * 5 + column * 3 + (column >> 2)) % 3 === 0 ? 1 : 0));
  let row = 0;
  const shape = {} as Shape;
  for (const side of SIDES) {
    shape[side] = {} as Shape['a'];
    for (const lane_ of LANES) shape[side][lane_] = lane(row++);
  }
  return shape;
};
const flat = (shape: Shape) => SIDES.flatMap((side) => LANES.flatMap((lane) => shape[side][lane]));

function open(cells: number) {
  const session = { status: 'ready', key: `ex122-${cells}`, bars: cells * 2, cells, seconds: cells * 4, start_shape: pattern(cells), shape: null };
  const calls = fakeBackend({ 'POST /mix/1/studio': session });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  const view = render(<Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} notify={() => {}} />);
  return { calls, view, session };
}

const listValues = () => screen.getAllByRole('checkbox').map((box) => ((box as HTMLInputElement).checked ? 1 : 0));
const mode = (name: 'Shape' | 'Detailed grid' | 'Detailed list') => fireEvent.click(screen.getByRole('button', { name }));

describe.each([8, 32, 64])('EX-0122 Studio parity at %i cells', (cells) => {
  beforeEach(() => {
    deck.made.length = 0;
  });
  afterEach(() => {
    window.localStorage.removeItem(`selecta.studio.ex122-${cells}`);
  });

  it('round-trips grid, list and Shape without changing a single cell', async () => {
    const { session } = open(cells);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /, bars? [0-9]/ })).toHaveLength(8 * cells));
    const pressed = () => screen.getAllByRole('button', { name: /, bars? [0-9]/ }).map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? 1 : 0));
    expect(pressed()).toEqual(flat(session.start_shape));
    mode('Detailed list');
    expect(listValues()).toEqual(flat(session.start_shape));
    mode('Shape');
    const guided = screen.getByRole('region', { name: 'Guided shape controls' });
    for (const side of SIDES) {
      const section = within(guided).getByRole('region', { name: side === 'a' ? 'Song 1' : 'Song 2' });
      expect(within(section).getAllByRole('group')).toHaveLength(LANES.length);
    }
    mode('Detailed grid');
    expect(pressed()).toEqual(flat(session.start_shape));
    mode('Detailed list');
    expect(listValues()).toEqual(flat(session.start_shape));
    // moving between views is not an edit: the audio deck never received a different shape
    expect(deck.made).toHaveLength(1);
    expect(deck.made[0].setShape).not.toHaveBeenCalled();
  });

  it('a guided lane edit changes exactly that lane, and Start again restores every cell', async () => {
    const { session } = open(cells);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /, bars? [0-9]/ })).toHaveLength(8 * cells));
    mode('Shape');
    const songTwo = within(screen.getByRole('region', { name: 'Guided shape controls' })).getByRole('region', { name: 'Song 2' });
    fireEvent.click(within(within(songTwo).getByRole('group', { name: 'Bass' })).getByRole('button', { name: 'Use throughout' }));
    mode('Detailed list');
    const expected = flat({ ...session.start_shape, b: { ...session.start_shape.b, bass: Array(cells).fill(1) } });
    expect(listValues()).toEqual(expected);
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(listValues()).toEqual(flat(session.start_shape));
  });

  it('keeps every lane’s solo and the ready-made shapes in Detailed mode', async () => {
    open(cells);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /, bars? [0-9]/ })).toHaveLength(8 * cells));
    for (const title of ['Song 1', 'Song 2']) {
      for (const part of ['voice', 'drums', 'bass', 'melody']) {
        expect(screen.getByRole('button', { name: `Hear only ${title} ${part}` })).toBeInTheDocument();
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Hear only Song 2 drums' }));
    expect(deck.made[0].solo).toHaveBeenLastCalledWith('b_drums');
    const presets = within(screen.getByRole('group', { name: 'Ready-made shapes' })).getAllByRole('button');
    expect(presets.length).toBeGreaterThan(0);
    fireEvent.click(presets[0]);
    expect(deck.made[0].setShape).toHaveBeenCalledTimes(1);
  });

  it('unsaved work survives every mode switch and a reopen, and nothing is applied', async () => {
    const { calls, view } = open(cells);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /, bars? [0-9]/ })).toHaveLength(8 * cells));
    mode('Detailed list');
    const last = screen.getAllByRole('checkbox')[8 * cells - 1];
    const was = (last as HTMLInputElement).checked;
    fireEvent.click(last);
    const edited = listValues();
    mode('Shape');
    mode('Detailed grid');
    mode('Detailed list');
    expect(listValues()).toEqual(edited);
    expect(calls.filter((call) => call.path.endsWith('/studio/use') || call.path.endsWith('/seam'))).toHaveLength(0);
    view.unmount();
    deck.made.length = 0;
    open(cells);
    await screen.findByText(/This is what you were working on before/);
    mode('Detailed list');
    expect(listValues()).toEqual(edited);
    expect((screen.getAllByRole('checkbox')[8 * cells - 1] as HTMLInputElement).checked).toBe(!was);
  });
});
