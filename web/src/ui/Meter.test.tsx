import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter, meterTone } from './Meter';

describe('one meter for progress and for how full', () => {
  it('is a progress bar with its words spoken', () => {
    render(<Meter label="Checking your music" value={312} max={2898} valueText="312 of 2,898 songs" />);
    const bar = screen.getByRole('progressbar', { name: 'Checking your music' });
    expect(bar).toHaveAttribute('aria-valuenow', '312');
    expect(bar).toHaveAttribute('aria-valuemax', '2898');
    expect(bar).toHaveAttribute('aria-valuetext', '312 of 2,898 songs');
    expect(bar.querySelector<HTMLElement>('.meter-fill')!.style.inlineSize).toMatch(/^10\.7/);
  });

  it('is a meter for a quantity, and takes its tone from the thresholds', () => {
    const { container } = render(<Meter kind="meter" label="Storage" value={9} max={10} warnAt={0.8} dangerAt={1} />);
    expect(screen.getByRole('meter', { name: 'Storage' })).toHaveAttribute('aria-valuetext', '90 percent');
    expect(container.querySelector('.meter')).toHaveAttribute('data-status', 'warning');
    expect(meterTone(1, 0.8, 1)).toBe('danger');
    expect(meterTone(0.2, 0.8, 1)).toBe('neutral');
  });

  it('has no number when nobody knows how far along it is', () => {
    const { container } = render(<Meter label="Files checked" />);
    const bar = screen.getByRole('progressbar', { name: 'Files checked' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.meter')).toHaveAttribute('data-indeterminate', 'true');
  });

  it('keeps its name when the label is hidden, and never overflows', () => {
    const { container } = render(<Meter label="Lucy turns" value={140} max={100} showLabel={false} tone="danger" />);
    expect(screen.getByRole('progressbar', { name: 'Lucy turns' })).toHaveAttribute('aria-valuenow', '100');
    expect(container.querySelector('.meter-label')).toHaveClass('visually-hidden');
    expect(container.querySelector('.meter')).toHaveAttribute('data-status', 'danger');
  });
});
