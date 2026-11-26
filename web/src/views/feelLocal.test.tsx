import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportShape, StageRing } from './feelLocal';

/** ADR-0477 plan 3.15: the first scan's rings and the finished export's outline draw only real
 * numbers, and say them in words. */
afterEach(cleanup);

describe('StageRing', () => {
  it('is a progress bar at the real count of the real total, and says it in words', () => {
    render(<StageRing label="Audio analysed" value={3} max={12} valueText="3 of 12 songs" />);
    const ring = screen.getByRole('progressbar', { name: 'Audio analysed' });
    expect(ring).toHaveAttribute('aria-valuenow', '3');
    expect(ring).toHaveAttribute('aria-valuemax', '12');
    expect(ring).toHaveAttribute('aria-valuetext', '3 of 12 songs');
    expect(ring).not.toHaveAttribute('data-complete');
    expect(ring.querySelector('.stage-ring-fill')?.getAttribute('style')).toContain('stroke-dashoffset: 0.75');
  });

  it('never runs past its total, and is complete only at it', () => {
    render(<StageRing label="Ready for mixes" value={9} max={6} valueText="6 of 6 needed" />);
    const ring = screen.getByRole('progressbar', { name: 'Ready for mixes' });
    expect(ring).toHaveAttribute('aria-valuenow', '6');
    expect(ring).toHaveAttribute('data-complete');
  });
});

describe('ExportShape', () => {
  it('draws the measured peaks, mirrored, as decoration', () => {
    const { container } = render(<ExportShape shape={[0, 0.5, 1]} />);
    const svg = container.querySelector('svg.export-shape');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 2 40');
    expect(svg?.querySelector('path')?.getAttribute('d')).toMatch(/^M0 19\.80 L1 10\.00 L2 0\.00 L2 40\.00 L1 30\.00 L0 20\.20 Z$/);
  });

  it('draws nothing for an older job that has no outline', () => {
    const { container } = render(<ExportShape shape={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
