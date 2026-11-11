import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

// Selecta 3.0 ADR-0059 item 8 (S3-0059-08): the grid must not remount while the
// playhead moves or a square changes, and one audio deck serves the whole session.

const deck = vi.hoisted(() => ({
  made: [] as { setShape: ReturnType<typeof vi.fn>; onCell: (cell: number) => void }[],
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
      load = vi.fn(async () => []);
      onCell: (cell: number) => void = () => {};
      constructor() {
        deck.made.push(this);
      }
    },
  };
});

const row = (value: number) => Array.from({ length: 8 }, () => value);
const shape = (a: number, b: number): Shape => ({
  a: { vocals: row(a), drums: row(a), bass: row(a), other: row(a) },
  b: { vocals: row(b), drums: row(b), bass: row(b), other: row(b) },
});
const ready = { status: 'ready', key: 'stable', bars: 16, cells: 8, seconds: 32, start_shape: shape(1, 0), shape: null };

function open() {
  fakeBackend({ 'POST /mix/1/studio': ready });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  render(<Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} notify={() => {}} />);
}

const cells = () => Array.from(document.querySelectorAll<HTMLElement>('button.studio-cell[data-cell]'));

describe('Studio grid stability (S3-0059-08)', () => {
  beforeEach(() => {
    deck.made.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem('selecta.studio.stable');
  });

  it('keeps every grid square mounted while the playhead moves through the bars', async () => {
    open();
    // Rendering the complete grid competes with other jsdom workers in the full
    // suite; this wait is for the same observable grid, not an implementation delay.
    await screen.findAllByRole('button', { name: /^Song 1 voice, bars? 1/ }, { timeout: 5000 });
    const before = cells();
    expect(before.length).toBeGreaterThanOrEqual(64);
    const live = deck.made[deck.made.length - 1];
    for (let index = 0; index < 8; index += 1) act(() => live.onCell(index));
    const after = cells();
    expect(after).toHaveLength(before.length);
    after.forEach((node, index) => expect(node).toBe(before[index]));
  });

  it('a toggle changes one square in place, keeps focus and makes no second audio deck', async () => {
    open();
    const [target] = await screen.findAllByRole('button', { name: /^Song 2 voice, bars? 1/ });
    const before = cells();
    const decks = deck.made.length;
    target.focus();
    fireEvent.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true');
    expect(target).toHaveFocus();
    const after = cells();
    after.forEach((node, index) => expect(node).toBe(before[index]));
    expect(deck.made.length).toBe(decks);
  });
});
