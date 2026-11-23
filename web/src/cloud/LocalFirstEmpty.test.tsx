import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixesEmpty } from './LocalFirstEmpty';

describe('MixesEmpty library-check count (BF-0463-04)', () => {
  it('updates the count silently: no live region, so milestones stay with the import announcer', () => {
    const { container, rerender } = render(<MixesEmpty connected={3} checking={{ checked: 1, total: 3 }} />);
    const count = screen.getByText(/1 of 3 songs checked\./);
    expect(screen.queryByRole('status')).toBeNull();
    expect(count).not.toHaveAttribute('role');
    expect(count).not.toHaveAttribute('aria-live');
    expect(count).not.toHaveAttribute('aria-atomic');
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
    const link = screen.getByRole('link', { name: 'See your library' });
    link.focus();

    rerender(<MixesEmpty connected={3} checking={{ checked: 2, total: 3 }} />);

    // the visual count still moves, in the same paragraph, and focus stays put
    expect(screen.getByText(/2 of 3 songs checked\./)).toBe(count);
    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull();
    expect(link).toHaveFocus();
  });
});
