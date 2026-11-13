import { appendFileSync } from 'node:fs';
import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

// r8c: the Studio playhead moves on every cell while a loop plays. That should redraw the squares
// it leaves and reaches, not the whole grid, and the grid must still show the playhead correctly.

const deck = vi.hoisted(() => ({ made: [] as { onCell: (cell: number) => void }[] }));

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
      load = vi.fn(async () => []);
      onCell: (cell: number) => void = () => {};
      constructor() { deck.made.push(this); }
    },
  };
});

const CELLS = 32;
const row = (on: number) => Array.from({ length: CELLS }, (_, index) => (index % on === 0 ? 1 : 0));
const shape: Shape = {
  a: { vocals: row(2), drums: row(3), bass: row(4), other: row(5) },
  b: { vocals: row(5), drums: row(4), bass: row(3), other: row(2) },
};

describe('r8c Studio playhead', () => {
  it('moving the playhead across 32 cells redraws only the squares it touches', async () => {
    fakeBackend({ 'POST /mix/1/studio': { status: 'ready', key: 'r8c', bars: 64, cells: CELLS, seconds: 128, start_shape: shape, shape: null } });
    const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
    let commits = 0;
    let ms = 0;
    render(
      <Profiler id="studio" onRender={(_id, _phase, actual) => { commits += 1; ms += actual; }}>
        <Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} notify={() => {}} />
      </Profiler>,
    );
    await screen.findByRole('grid');
    expect(document.querySelectorAll('.studio-cell')).toHaveLength(CELLS * 8);
    commits = 0;
    ms = 0;
    const made = deck.made.at(-1)!;
    for (let cell = 0; cell < CELLS; cell += 1) act(() => made.onCell(cell));
    const line = `[r8c] studio, playhead over ${CELLS} cells x 8 lanes: ${commits} commits, ${ms.toFixed(1)} ms`;
    console.info(line);
    if (process.env.R8C_METRICS) appendFileSync(process.env.R8C_METRICS, line + '\n');
    expect(commits).toBe(CELLS);
    const lit = [...document.querySelectorAll('.studio-cell.now')].map((cell) => cell.getAttribute('data-cell'));
    expect(lit).toHaveLength(8);
    expect(lit.every((cell) => cell?.endsWith(`-${CELLS - 1}`))).toBe(true);
    expect(screen.getByRole('button', { name: /^Song 1 voice, bars 1\D/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
