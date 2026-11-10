import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import polish from '../styles/polish.css?raw';
import shell from '../styles/shell.css?raw';
import { Skeleton } from './Skeleton';

/** UF-0371-02: a placeholder is for content whose shape isn't known yet, and it never shimmers forever.
 * It breathes a few times at most, not at all with reduced motion, and after a long wait it says what
 * it is waiting for instead of pretending progress. Known long work (analysis, renders, exports) shows
 * its job status instead, through the shared vocabulary in state/workState.ts. */

afterEach(() => vi.useRealTimers());

describe('honest placeholders', () => {
  it('is a polite busy status with a name, then says it is still waiting after ten seconds', () => {
    vi.useFakeTimers();
    render(<Skeleton label="Loading songs" variant="library" />);
    const status = screen.getByRole('status', { name: 'Loading songs' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/Still waiting for Selecta/)).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText(/Still waiting for Selecta\. If the server has stopped, start it again\./)).toBeInTheDocument();
  });

  it('the breathing animation stops after a few cycles, and never runs with reduced motion', () => {
    expect(shell).toMatch(/\.skeleton i \{[^}]*animation: skeleton-breathe[^}]*\}/);
    expect(polish).toMatch(/\.skeleton i \{ animation-iteration-count: 3; \}/);
    expect(shell).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.skeleton i \{ animation: none; \} \}/);
  });
});
