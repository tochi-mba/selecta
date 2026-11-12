import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MixItem } from '../api';
import { SeamDiagram, SongMotif } from '../ui/MusicObjects';

/** SF-0207-07: the Thread's song and seam objects are one component contract, reused across every
 * route that shows them, with no state shared between the places they appear. */

// Same disk access as importBoundaries.test.ts: the app's tsconfig has no Node types.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const read = (file: string) => fs.readFileSync(`${SOURCE}${file}`, 'utf8');

const VIEWS = fs.readdirSync(`${SOURCE}views/`)
  .filter((name) => /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name))
  .map((name) => `views/${name}`);

/** The routes each object is promised on (Listen, Edit, Inspector, Library, Requests, Studio, Lucy). */
const MOTIF_SURFACES = ['views/Now.tsx', 'views/EditorRows.tsx', 'views/SeamInspector.tsx', 'views/LibraryRow.tsx',
  'views/Requests.tsx', 'views/Studio.tsx', 'views/LucySongs.tsx', 'views/SongDetails.tsx'];
const SEAM_SURFACES = ['views/EditorRows.tsx', 'views/SeamInspector.tsx'];

function seam(status: 'planned' | 'ready'): NonNullable<MixItem['seam']> {
  return {
    settings: { move: 'auto' },
    state: status === 'ready' ? { status: 'ready', style: 'blend', label: 'Blend' } : { status: 'planned' },
  } as unknown as NonNullable<MixItem['seam']>;
}

describe('the Thread across routes (SF-0207-07)', () => {
  it('every route that draws a song motif or seam imports the one shared component', () => {
    const users = (tag: string) => VIEWS.filter((file) => read(file).includes(`<${tag}`));
    expect(users('SongMotif')).toEqual(expect.arrayContaining(MOTIF_SURFACES));
    expect(users('SeamDiagram')).toEqual(expect.arrayContaining(SEAM_SURFACES));
    const wrongSource = [...users('SongMotif'), ...users('SeamDiagram')].filter((file) =>
      !/import \{[^}]*\b(SongMotif|SeamDiagram)\b[^}]*\} from '\.\.\/ui\/MusicObjects'/.test(read(file)));
    expect(wrongSource).toEqual([]);
  });

  it('no route draws its own copy of the motif or seam diagram', () => {
    const copies = VIEWS.filter((file) => {
      const text = read(file);
      return /function (SongMotif|SeamDiagram)\b/.test(text) || /className=["'{][^"'}]*\b(song-motif|music-seam-diagram)\b/.test(text);
    });
    expect(copies).toEqual([]);
  });

  it('the shared module keeps no state between the places it appears', () => {
    const module = read('ui/MusicObjects.tsx');
    expect(module.match(/^(let|var) /gm) ?? []).toEqual([]);
    expect(module).not.toMatch(/createContext|useContext|from '\.\.\/state\//);
  });

  it('the same song looks the same on any route, and one route changing does not touch another', () => {
    const listen = render(<SongMotif songId={41} large />);
    const library = render(<SongMotif songId={41} />);
    const first = library.container.querySelector('svg')!.innerHTML;
    expect(listen.container.querySelector('svg')!.innerHTML).toBe(first);
    listen.rerender(<SongMotif songId={99} large />);
    expect(library.container.querySelector('svg')!.innerHTML).toBe(first);
  });

  it('a seam says the same thing in the compact Edit row and the full Inspector', () => {
    for (const status of ['planned', 'ready'] as const) {
      const row = render(<SeamDiagram seam={seam(status)} from="One" into="Two" compact />);
      const inspector = render(<SeamDiagram seam={seam(status)} from="One" into="Two" />);
      const label = (view: typeof row) => view.container.querySelector('[role="img"]')!.getAttribute('aria-label');
      expect(label(row)).toBe(label(inspector));
      expect(row.container.firstElementChild!.getAttribute('data-state')).toBe(status);
      row.unmount();
      inspector.unmount();
    }
  });
});
