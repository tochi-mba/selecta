import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MixItem } from '../api';
import { EnergyThumb, MixHorizon, SeamDiagram } from './MusicObjects';

/**
 * Flow SF-0207-04, the automatable part: everything a Thread drawing shows can be read without
 * seeing it move, or seeing it at all. The drawing is hidden from assistive technology, the same
 * state is spelt out in words on screen and in the accessible name, and nothing depends on motion.
 * Hearing it with NVDA is the person's part.
 */
type Seam = NonNullable<MixItem['seam']>;
const base: Seam = { settings: { move: 'auto' }, state: { status: 'queued', key: 'k' } };
const STATES: [Seam['state'], string][] = [
  [{ status: 'queued', key: 'k' }, 'Queued to render'],
  [{ status: 'rendering', key: 'k' }, 'Rendering'],
  [{ status: 'failed', key: 'k' }, 'Render failed'],
  [{ status: 'ready', key: 'k', style: 'cut_on_one' }, 'Rendered transition'],
];

describe('Thread drawings say what they show (SF-0207-04)', () => {
  it.each(STATES)('a %o seam names its state in words on screen and to assistive technology', (state, words) => {
    const { container } = render(<SeamDiagram seam={{ ...base, state }} from="First song" into="Second song" />);
    const diagram = screen.getByRole('img');
    const name = diagram.getAttribute('aria-label') ?? '';
    expect(name).toContain(words);
    expect(name).toContain('from First song into Second song');
    expect(container.querySelector('.music-seam-label')?.textContent).toContain(words);
    // the lines are decoration: hidden from assistive technology and carrying no words of their own
    const lines = container.querySelector('.music-seam-lines')!;
    expect(lines).toHaveAttribute('aria-hidden', 'true');
    expect(lines.textContent).toBe('');
  });

  it('says in words when the rendered move differs from the one asked for', () => {
    const seam: Seam = { settings: { move: 'echo_out' }, state: { status: 'ready', key: 'k', style: 'cut_on_one', fell_back: true } };
    const { container } = render(<SeamDiagram seam={seam} from="A" into="B" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Different from the requested move');
    expect(container.querySelector('.music-seam-label')?.textContent).toContain('(different move)');
  });

  it('the compact form gives the same description as the full one', () => {
    const seam: Seam = { ...base, state: { status: 'rendering', key: 'k' } };
    const { container: full } = render(<SeamDiagram seam={seam} from="A" into="B" />);
    const { container: compact } = render(<SeamDiagram seam={seam} from="A" into="B" compact />);
    const label = (root: HTMLElement) => root.querySelector('[role="img"]')?.getAttribute('aria-label');
    expect(label(compact)).toBe(label(full));
  });

  it('an energy thumbnail and the start-to-finish shape give their values as text', () => {
    render(<EnergyThumb values={[20, 50, 80]} />);
    const thumb = screen.getByRole('img');
    expect(thumb.getAttribute('aria-label')).toBeTruthy();
    expect(thumb.getAttribute('title')).toBe(thumb.getAttribute('aria-label'));

    const items = [{ energy: 0.2 }, { energy: 0.5 }, { energy: 0.9 }] as Pick<MixItem, 'energy'>[];
    const { container } = render(<MixHorizon items={items} scope="current" />);
    const stops = screen.getByRole('list', { name: 'Measured energy at each stop' });
    expect(stops.querySelectorAll('li').length).toBeGreaterThan(1);
    expect(stops.textContent).toMatch(/\d+ out of 100/);
    expect(container.querySelector('.hint')?.textContent).toMatch(/Measured from this mix/);
  });
});
