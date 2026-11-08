import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../shell/commands';
import { CommandPalette } from './CommandPalette';

const command = (id: string, run = vi.fn()): Command => ({
  id, label: id, group: 'Do', run,
});

describe('command palette safety', () => {
  it('clamps the active command if a live result list becomes shorter', () => {
    const previous = [command('first'), command('second'), command('third')];
    const next = command('latest');
    const close = vi.fn();
    const { rerender } = render(<CommandPalette commands={previous} onClose={close} />);
    const input = screen.getByRole('combobox', { name: 'Search for a page or a command' });
    fireEvent.keyDown(input, { key: 'End' });
    expect(screen.getByRole('option', { name: /third/ })).toHaveAttribute('aria-selected', 'true');
    rerender(<CommandPalette commands={[next]} onClose={close} />);
    expect(screen.getByRole('option', { name: /latest/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(next.run).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(previous[2].run).not.toHaveBeenCalled();
  });

  it('shows exact Undo scope but refuses an unavailable mutation', () => {
    const run = vi.fn();
    render(<CommandPalette commands={[{ ...command('Undo the last change', run), detail: 'Draft: Friday', unavailable: 'Wait for this draft to load.' }]} onClose={vi.fn()} />);
    expect(screen.getByText('Wait for this draft to load.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('Wait for this draft to load.');
    expect(run).not.toHaveBeenCalled();
  });
});
