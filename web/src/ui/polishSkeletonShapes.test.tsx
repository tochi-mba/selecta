import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

// Vitest hands CSS ?raw imports back empty, so the sheet is read from disk (as spacing-tokens.test.ts does).
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const polish = fs.readFileSync(`${node.cwd()}/src/styles/polish.css`, 'utf8');
// the Listen view and its seek strip (split into NowStrip.tsx for the file length limit)
const now = ['Now.tsx', 'NowStrip.tsx'].map((file) => fs.readFileSync(`${node.cwd()}/src/views/${file}`, 'utf8')).join('\n');

/** UI/UX polish ADR-0036 P0032, P0034 and P0036: the shapes behind each content-shaped placeholder.
 * The rendered geometry is measured in web/e2e/polish-p0032-p0036-skeleton-geometry.e2e.ts. */
describe('content-shaped placeholders', () => {
  it('P0032 a Mix card is motif, name, summary, facts, disclosure and two actions with Save draft under them', () => {
    const { container } = render(<Skeleton variant="vibes" lines={3} label="Finding compatible mix candidates" />);
    const units = container.querySelectorAll('.skeleton-content > .skeleton-vibe');
    expect(units).toHaveLength(3);
    const parts = [...units[0].children].map((child) => child.className);
    expect(parts).toEqual(['skeleton-motif', 'skeleton-title', 'skeleton-detail', 'skeleton-meta', 'skeleton-disclosure', 'skeleton-actions']);
    expect(units[0].querySelectorAll('.skeleton-actions > .skeleton-action')).toHaveLength(2);
    expect(units[0].querySelectorAll('.skeleton-actions > .skeleton-action-quiet')).toHaveLength(1);
    expect(container.querySelector('.skeleton-content')!.textContent).toBe('');
  });

  it('P0034 the Listen placeholder is lyric lines only, with no region standing for audio', () => {
    const { container } = render(<Skeleton variant="listen" lines={2} label="Loading this song" />);
    const units = container.querySelectorAll('.skeleton-content > .skeleton-unit');
    expect(units).toHaveLength(1);
    expect([...units[0].children].map((child) => child.className)).toEqual(['skeleton-meta', 'skeleton-detail', 'skeleton-title', 'skeleton-detail']);
    expect(container.querySelector('.skeleton-region, canvas, svg, path')).toBeNull();
    // the waveform's place is a flat block with nothing inside it, hidden from assistive tech
    expect(now).toMatch(/<div className="skeleton-strip" aria-hidden="true" data-revealed=\{revealed\} \/>/);
    expect(polish).toMatch(/\.skeleton-strip \{ height: 92px; margin: var\(--space-2\) 0 var\(--space-5\);[^}]*background: var\(--surface-control\); \}/);
  });

  it('P0036 list-shaped information is label and status rows, one per row asked for', () => {
    const { container } = render(<Skeleton variant="rows" lines={4} label="Finding out what’s running" />);
    const rows = container.querySelectorAll('.skeleton-content > .skeleton-row');
    expect(rows).toHaveLength(4);
    for (const row of rows) expect([...row.children].map((child) => child.className)).toEqual(['skeleton-title', 'skeleton-detail']);
  });
});
