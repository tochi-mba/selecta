import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MixItem } from '../api';
import { mixReadiness } from '../state/readiness';
import { MixSignature, SeamDiagram, SongMotif } from './MusicObjects';

/**
 * Flow SF-0207-05, the automatable part: the player, the mix card and the editor draw the Thread with
 * one grammar. Each object has a compact form and an expanded one, and the compact form only drops
 * size and detail: the same parts, in the same order, with the same state words and the same
 * accessible meaning. The 320-2560 visual review is web/e2e/sf0207-thread-forms.e2e.ts plus a person.
 */

// Same disk access as sf0207ThreadContract.test.tsx: the app's tsconfig has no Node types.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const read = (file: string) => fs.readFileSync(`${node.cwd()}/src/${file}`, 'utf8');

/** Classes that only size a form. Anything else on the element is grammar and must match. */
const SIZE_ONLY = new Set(['compact', 'large']);

/** The drawing's parts in document order: tag, grammar classes, role, hidden-ness and state data. */
function parts(root: Element): string[] {
  return [root, ...root.querySelectorAll('*')].map((element) => [
    element.tagName.toLowerCase(),
    [...element.classList].filter((name) => !SIZE_ONLY.has(name)).sort().join('.'),
    element.getAttribute('role') ?? '',
    element.getAttribute('aria-hidden') ?? '',
    element.getAttribute('data-state') ?? '',
    element.getAttribute('data-family') ?? '',
  ].join('|'));
}

type Seam = NonNullable<MixItem['seam']>;
const SEAMS: [string, Seam][] = [
  ['planned', { settings: { move: 'auto' }, state: { status: 'none', key: 'k' } }],
  ['queued', { settings: { move: 'echo_out' }, state: { status: 'queued', key: 'k' } }],
  ['rendering', { settings: { move: 'word_blend' }, state: { status: 'rendering', key: 'k' } }],
  ['failed', { settings: { move: 'stem_studio' }, state: { status: 'failed', key: 'k', error: 'x' } }],
  ['ready', { settings: { move: 'auto' }, state: { status: 'ready', key: 'k', style: 'cut_on_one', label: 'Cut' } }],
  ['ready, but different move', { settings: { move: 'echo_out' }, state: { status: 'ready', key: 'k', style: 'bass_swap_blend', fell_back: true } }],
  ['ready, would be missed', { settings: { move: 'auto' }, state: { status: 'ready', key: 'k', style: 'filter_sweep' }, too_soon: true }],
];

/** The closed state vocabulary every form of the seam speaks, and nothing else. */
const STATE_WORDS = ['Planned, not rendered', 'Queued to render', 'Rendering', 'Render failed', 'Rendered transition', 'Rendered; would be missed'];

describe('Thread compact and expanded forms share one grammar (SF-0207-05)', () => {
  it('the player, card and editor each draw from the one Thread module, in their stated form', () => {
    const uses: [string, RegExp][] = [
      ['views/Now.tsx', /<SongMotif songId=\{songId\} large \/>/], // player: expanded song mark
      ['views/CurrentMix.tsx', /<MixSignature items=\{mix\} \/>/], // card: expanded mix mark
      ['views/Drafts.tsx', /<MixSignature items=\{signature\} compact \/>/], // card: compact mix mark
      ['views/EditorRows.tsx', /<SongMotif songId=\{item\.song_id\} \/>/], // editor row: compact song mark
      ['views/EditorRows.tsx', /<SeamDiagram [^>]*compact \/>/], // editor row: compact seam
      ['views/SeamInspector.tsx', /<SeamDiagram seam=\{seam\} [^>]*names=\{names\} \/>/], // editor inspector: expanded seam
    ];
    for (const [file, pattern] of uses) {
      const text = read(file);
      expect(text, file).toMatch(pattern);
      expect(text, file).toMatch(/from '\.\.\/ui\/MusicObjects'/);
    }
  });

  it('a song mark in the player is the same drawing as in the editor row, only larger', () => {
    for (const id of [1, 7, 41, 1234]) {
      const player = render(<SongMotif songId={id} large />);
      const row = render(<SongMotif songId={id} />);
      const big = player.container.querySelector('svg')!;
      const small = row.container.querySelector('svg')!;
      expect(big.classList.contains('large')).toBe(true);
      expect(parts(small)).toEqual(parts(big));
      expect(small.innerHTML).toBe(big.innerHTML);
      expect(small.getAttribute('aria-hidden')).toBe('true');
      player.unmount();
      row.unmount();
    }
  });

  it('a mix mark on a draft card is the same drawing as on the current mix card, only smaller', () => {
    const items = [{ song_id: 3 }, { song_id: 9 }, { song_id: 3 }, { song_id: 12 }];
    const card = render(<MixSignature items={items} />);
    const draft = render(<MixSignature items={items} compact />);
    const full = card.container.querySelector('svg')!;
    const compact = draft.container.querySelector('svg')!;
    expect(compact.classList.contains('compact')).toBe(true);
    expect(parts(compact)).toEqual(parts(full));
    expect(compact.innerHTML).toBe(full.innerHTML);
  });

  it.each(SEAMS)('a %s seam has the same parts, order, state and words in the editor row and the inspector', (_name, seam) => {
    const row = render(<SeamDiagram seam={seam} from="Paper Moon" into="Night Drive" compact />);
    const inspector = render(<SeamDiagram seam={seam} from="Paper Moon" into="Night Drive" />);
    const small = row.container.querySelector('.music-seam-diagram')!;
    const full = inspector.container.querySelector('.music-seam-diagram')!;
    expect(small.classList.contains('compact')).toBe(true);
    expect(full.classList.contains('compact')).toBe(false);
    expect(parts(small)).toEqual(parts(full));
    expect(small.getAttribute('aria-label')).toBe(full.getAttribute('aria-label'));
    const words = (element: Element) => element.querySelector('.music-seam-label')!.textContent;
    expect(words(small)).toBe(words(full));
    // the state word leads, in both forms, and comes from the one closed vocabulary
    const lead = words(small)!.split(' · ')[0];
    expect(STATE_WORDS).toContain(lead);
    expect(small.getAttribute('aria-label')!.startsWith(lead)).toBe(true);
  });

  it('the card counts exactly what the editor draws for each seam state', () => {
    for (const [name, seam] of SEAMS) {
      const mix = [{ song_id: 1, seam: null }, { song_id: 2, seam }] as unknown as MixItem[];
      const facts = mixReadiness(mix);
      const { container, unmount } = render(<SeamDiagram seam={seam} from="A" into="B" compact />);
      const drawn = container.querySelector('.music-seam-diagram')!;
      const made = drawn.classList.contains('is-made');
      expect(facts.ready, name).toBe(made && !seam.too_soon ? 1 : 0);
      expect(facts.blocked, name).toBe(seam.too_soon ? 1 : 0);
      expect(facts.failed, name).toBe(drawn.getAttribute('data-state') === 'failed' ? 1 : 0);
      expect(facts.rendering, name).toBe(['queued', 'rendering'].includes(drawn.getAttribute('data-state')!) ? 1 : 0);
      // a plan is never drawn as made, in either form
      expect(made, name).toBe(seam.state.status === 'ready');
      unmount();
    }
  });
});
