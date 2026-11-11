import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

// Vitest hands CSS ?raw imports back empty, so the sheets are read from disk (as spacing-tokens.test.ts does).
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const read = (path: string) => fs.readFileSync(`${node.cwd()}/src/${path}`, 'utf8');

/** UI/UX polish ADR-0036 P0035: Edit's placeholders keep the timeline's and the inspector's geometry.
 * The timeline is song rows with a transition hanging between each pair, so the placeholder is too,
 * at the same row heights the long timeline reserves; the inspector placeholder keeps its panel. */

describe('P0035 Edit placeholders', () => {
  it('the timeline placeholder alternates song rows and transitions, one fewer transition than songs', () => {
    const { container } = render(<Skeleton variant="timeline" lines={4} label="Opening your draft" />);
    expect(screen.getByRole('status', { name: 'Opening your draft' })).toHaveAttribute('aria-busy', 'true');
    const units = [...container.querySelectorAll('.skeleton-content > .skeleton-unit')];
    expect(units.map((unit) => (unit.classList.contains('skeleton-song') ? 'song' : 'seam'))).toEqual(
      ['song', 'seam', 'song', 'seam', 'song', 'seam', 'song'],
    );
    // a song row has a grip column, its title and artist and its facts; a transition its name, region and action
    expect(units[0].querySelectorAll('.skeleton-grip, .skeleton-title, .skeleton-detail, .skeleton-meta')).toHaveLength(4);
    expect(units[1].querySelectorAll('.skeleton-title, .skeleton-region, .skeleton-action')).toHaveLength(3);
    // shapes only: nothing a screen reader or a person could read as a song
    expect(container.querySelector('.skeleton-content')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.skeleton-content')!.textContent).toBe('');
  });

  it('one song still draws a row and no transition', () => {
    const { container } = render(<Skeleton variant="timeline" lines={1} />);
    expect(container.querySelectorAll('.skeleton-song')).toHaveLength(1);
    expect(container.querySelectorAll('.skeleton-seam')).toHaveLength(0);
  });

  it('rows use the timeline’s own heights, columns and transition indent', () => {
    const polish = read('styles/polish.css');
    const creation = read('styles/creation.css');
    const height = (sheet: string, selector: RegExp) => Number(sheet.match(selector)?.[1]);
    expect(height(creation, /\.timeline\.long > \.song \{[^}]*contain-intrinsic-size: auto (\d+)px/)).toBe(
      height(polish, /\.skeleton-timeline \.skeleton-song \{[^}]*min-height: (\d+)px/),
    );
    expect(height(creation, /\.timeline\.long > \.seam \{[^}]*contain-intrinsic-size: auto (\d+)px/)).toBe(
      height(polish, /\.skeleton-timeline \.skeleton-seam \{[^}]*min-height: (\d+)px/),
    );
    // the grip column is the real grip's width; transitions hang off a left rule like the real ones
    expect(creation).toMatch(/\.timeline \.song \{[^}]*grid-template-columns: var\(--control-height\)/);
    expect(polish).toMatch(/\.skeleton-timeline \.skeleton-song \{[^}]*grid-template-columns: var\(--control-height\)/);
    expect(polish).toMatch(/\.skeleton-timeline \.skeleton-seam \{[^}]*border-left: 2px solid var\(--border\)/);
  });

  it('opening a draft on Edit shows the timeline placeholder, and the inspector keeps its panel placeholder', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/route\.page === 'edit' && draftId !== null[^\n]*<Skeleton variant="timeline"/);
    expect(read('views/SeamInspector.tsx')).toMatch(/<Skeleton variant="inspector"/);
    const { container } = render(<Skeleton variant="inspector" lines={5} />);
    expect(container.querySelectorAll('.skeleton-unit')).toHaveLength(1);
    expect(container.querySelectorAll('.skeleton-region, .skeleton-action')).toHaveLength(2);
  });
});
