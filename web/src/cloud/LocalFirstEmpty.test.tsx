import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixesEmpty } from './LocalFirstEmpty';

describe('MixesEmpty progress announcement (BF-0463-04)', () => {
  it('announces library-check progress politely and updates the same status region', () => {
    const { rerender } = render(<MixesEmpty connected={3} checking={{ checked: 1, total: 3 }} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('1 of 3 songs checked so far');
    const link = screen.getByRole('link', { name: 'See your library' });
    link.focus();

    rerender(<MixesEmpty connected={3} checking={{ checked: 2, total: 3 }} />);

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('2 of 3 songs checked so far');
    expect(link).toHaveFocus();
  });
});
