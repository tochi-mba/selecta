import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

/**
 * ADR-0084 (S31-0084-02): voice, drums, bass and melody lanes, and each square's on, off, now,
 * soloed, quietened and unavailable states, are told apart without colour: by words on screen, by
 * shape and line, and by the name a screen reader hears. Colour may add to these, never replace them.
 */

const deck = vi.hoisted(() => ({ lost: undefined as string[] | undefined }));

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
      load = vi.fn(async () => deck.lost);
      onCell: (cell: number) => void = () => {};
    },
  };
});

const row = (value: number) => [value, 0, value, 0, value, 0, value, 0];
const shape = (a: number, b: number): Shape => ({
  a: { vocals: row(a), drums: row(a), bass: row(a), other: row(a) },
  b: { vocals: row(b), drums: row(b), bass: row(b), other: row(b) },
});
const ready = { status: 'ready', key: 'abc', bars: 16, cells: 8, seconds: 32, start_shape: shape(1, 1), shape: null };

function open() {
  fakeBackend({ 'POST /mix/1/studio': ready });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  render(<Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} onListen={() => {}} notify={() => {}} />);
}

type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const sheets = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)]
  .map((file) => fs.readFileSync(SOURCE + file, 'utf8')).join('\n');
/** The declarations of every rule whose selector includes `selector`. */
const rulesFor = (selector: string) => [...sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) => rule[1].includes(selector)).map((rule) => rule[2]).join(';');

describe('S31-0084-02 Studio lanes and squares read without colour', () => {
  beforeEach(() => { deck.lost = undefined; });

  it('every lane carries its part name in words, on screen and in each square’s name', async () => {
    open();
    await screen.findAllByRole('button', { name: /^Song 1 voice, bars? / });
    const lanes = [...document.querySelectorAll<HTMLElement>('.studio-grid .studio-lane:not(.studio-ruler)')];
    expect(lanes).toHaveLength(8);
    expect(lanes.map((lane) => lane.querySelector('.studio-name')?.textContent)).toEqual(['Voice', 'Drums', 'Bass', 'Melody', 'Voice', 'Drums', 'Bass', 'Melody']);
    for (const part of ['voice', 'drums', 'bass', 'melody']) {
      for (const song of ['Song 1', 'Song 2']) {
        const squares = screen.getAllByRole('button', { name: new RegExp(`^${song} ${part}, bars? `) });
        expect(squares).toHaveLength(8);
        // on and off are said in the name, not left to a fill colour
        expect(squares[0]).toHaveAccessibleName(/, on$/);
        expect(squares[1]).toHaveAccessibleName(/, off$/);
        expect(squares[0]).toHaveAttribute('aria-pressed', 'true');
        expect(squares[1]).toHaveAttribute('aria-pressed', 'false');
      }
    }
  });

  it('hearing one part alone says so in words, and the others are marked quieter as well as faded', async () => {
    open();
    const name = await screen.findByRole('button', { name: 'Hear only Song 1 drums' });
    fireEvent.click(name);
    expect(name).toHaveAttribute('aria-pressed', 'true');
    expect(name).toHaveTextContent('Solo: Drums');
    const lanes = [...document.querySelectorAll<HTMLElement>('.studio-grid .studio-lane:not(.studio-ruler)')];
    expect(lanes.filter((lane) => lane.classList.contains('soloed'))).toHaveLength(1);
    expect(lanes.filter((lane) => lane.classList.contains('silenced'))).toHaveLength(7);
    // the soloed name is bold as well as worded; the rest fade, a change of contrast rather than hue
    expect(rulesFor('.studio-lane.soloed .studio-name')).toMatch(/font-weight:\s*700/);
    expect(rulesFor('.studio-lane.silenced .studio-cell')).toMatch(/opacity:\s*0\.\d+/);
  });

  it('on, now and unavailable each have a shape or line of their own, not only a colour', () => {
    // on: a filled mark inside the square and a bar along its foot
    expect(rulesFor(".studio-cell[aria-pressed='true']::after")).toMatch(/content:\s*''/);
    expect(rulesFor(".studio-cell[aria-pressed='true']")).toMatch(/box-shadow:\s*inset 0 -3px 0/);
    // being played: a heavier top edge
    expect(rulesFor('.studio-cell.now')).toMatch(/border-top:\s*3px solid/);
    // unavailable: hatching and a struck-through name, as well as the words "unavailable"
    expect(rulesFor('.studio-lane.lost .studio-cell')).toMatch(/repeating-linear-gradient/);
    expect(rulesFor('.studio-lane.lost .studio-name')).toMatch(/text-decoration:\s*line-through/);
    // and in forced colours, where every colour is replaced, the on state keeps a border of its own
    expect(sheets).toMatch(/\.studio-cell\[aria-pressed='true'\] \{ border: 3px solid Highlight; \}/);
  });

  it('no lane is given a colour of its own that would be the only way to tell it apart', () => {
    for (const lane of ['vocals', 'drums', 'bass', 'other']) {
      expect(sheets).not.toMatch(new RegExp(`\\.(studio-)?lane-${lane}\\b[^{]*\\{[^}]*(?:background|color)`));
      expect(sheets).not.toMatch(new RegExp(`\\[data-lane=['"]?${lane}`));
    }
  });

  it('a part that could not be loaded says so in its name, not only by fading', async () => {
    deck.lost = ['b_bass'];
    open();
    expect(await screen.findByRole('button', { name: 'Hear only Song 2 bass, unavailable' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Song 2 bass, .*, unavailable$/ })).toHaveLength(8);
  });
});
