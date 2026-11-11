import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

/** GP-0261-07: the Studio at its largest, 64 cells in each of the eight lanes (512 squares).
 * Painting stays consistent, the grid stays one tab stop with keyboard reach to every corner,
 * and Start again puts the whole grid back. Audio is a stand-in; nothing is rendered. jsdom is not a
 * timing instrument, so responsiveness on real hardware is left to the browser check in the ADR. */

const deck = vi.hoisted(() => ({ made: [] as { setShape: ReturnType<typeof vi.fn> }[] }));
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
      constructor() { deck.made.push(this); }
    },
  };
});

const CELLS = 64;
const row = (value: number) => Array.from({ length: CELLS }, () => value);
const shape = (a: number, b: number): Shape => ({
  a: { vocals: row(a), drums: row(a), bass: row(a), other: row(a) },
  b: { vocals: row(b), drums: row(b), bass: row(b), other: row(b) },
});

function open() {
  fakeBackend({ 'POST /mix/1/studio': { status: 'ready', key: 'big', bars: 128, cells: CELLS, seconds: 256, start_shape: shape(1, 0), shape: null } });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  render(<Studio position={1} item={item} previous={previous} onClose={vi.fn()} onUsed={vi.fn()} onListen={vi.fn()} notify={vi.fn()} />);
}

const cells = () => screen.getAllByRole('button', { name: /^Song [12] (voice|drums|bass|melody), bars? [0-9]/ });

afterEach(() => {
  window.localStorage.removeItem('selecta.studio.big');
  deck.made.length = 0;
});

describe('GP-0261-07 a 64-cell Studio', () => {
  it('shows all 512 squares as one tab stop and reaches every corner by keyboard', async () => {
    open();
    await screen.findAllByRole('button', { name: /^Song 1 voice, bars? [0-9]/ }, { timeout: 30_000 });
    expect(cells()).toHaveLength(8 * CELLS);
    expect(cells().filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    const first = cells()[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'End', ctrlKey: true });
    const last = document.activeElement as HTMLElement;
    expect(last.getAttribute('aria-label')).toMatch(/^Song 2 melody, bars? 127/);
    fireEvent.keyDown(last, { key: 'Home' });
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(/^Song 2 melody, bars? 1\b/);
    fireEvent.keyDown(document.activeElement!, { key: 'Home', ctrlKey: true });
    expect(document.activeElement).toBe(first);
    expect(cells().filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
  }, 180_000);

  it('paints one value across a whole 64-cell lane and Start again restores it', async () => {
    open();
    await screen.findAllByRole('button', { name: /^Song 1 voice, bars? [0-9]/ }, { timeout: 30_000 });
    const lane = cells().filter((cell) => /^Song 1 voice,/.test(cell.getAttribute('aria-label')!));
    expect(lane).toHaveLength(CELLS);
    expect(lane.every((cell) => cell.getAttribute('aria-pressed') === 'true')).toBe(true);
    const grid = screen.getByRole('grid');
    const prior = document.elementFromPoint;
    let under: Element = lane[0];
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => under });
    try {
      fireEvent.pointerDown(lane[0], { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 1, clientY: 1 });
      for (const cell of [...lane.slice(1), ...lane.slice(0, 8).reverse()]) {
        under = cell;
        fireEvent.pointerMove(grid, { pointerId: 7, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: 2, clientY: 1 });
      }
      fireEvent.pointerUp(grid, { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0 });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: prior });
    }
    // every square the stroke touched took the first square's new value, once, including revisits
    expect(lane.map((cell) => cell.getAttribute('aria-pressed'))).toEqual(row(0).map(() => 'false'));
    // the other seven lanes are untouched
    expect(cells().filter((cell) => /^Song 1 drums,/.test(cell.getAttribute('aria-label')!)).every((cell) => cell.getAttribute('aria-pressed') === 'true')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(lane.every((cell) => cell.getAttribute('aria-pressed') === 'true')).toBe(true);
  }, 180_000);
});
