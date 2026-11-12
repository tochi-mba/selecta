import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../shell/commands';
import { fakeBackend } from '../test/backend';
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
  it('opens the exact recording ID even when different results share a title', async () => {
    window.history.pushState({}, '', '/listen');
    const calls = fakeBackend({
      'GET /library': {
        songs: [
          { id: 11, title: 'Shared', artist: 'Artist', bpm: null, readiness: { status: 'queued', reason: '' } },
          { id: 72, title: 'Shared', artist: 'Artist', bpm: null, readiness: { status: 'queued', reason: '' } },
        ],
        total: 2, next: null,
      },
    });
    const close = vi.fn();
    render(<CommandPalette commands={[]} onClose={close} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Shared' } });
    const exact = await screen.findByRole('option', { name: /Song: Shared.*song 72/ });
    fireEvent.click(exact);
    expect(close).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/library');
    const query = new URLSearchParams(window.location.search);
    expect(query.get('q')).toBe('72');
    expect(query.get('song')).toBe('72');
    expect(query.get('show')).toBe('all');
    expect(calls.some((call) => call.path.includes('q=Shared'))).toBe(true);
  });
});
