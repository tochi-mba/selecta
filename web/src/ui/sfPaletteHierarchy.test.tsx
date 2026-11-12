import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../shell/commands';
import { fakeBackend } from '../test/backend';
import { CommandPalette } from './CommandPalette';

const make = (id: string, label: string, group: Command['group']): Command => ({ id, label, group, run: vi.fn() });

// SF-0244-02: songs, mixes (your drafts), routes (pages) and actions are told apart by a named group
// and by a kind said before each result's name, so the same word can't be mistaken for another kind.
describe('SF-0244-02 the palette tells songs, mixes, routes and actions apart', () => {
  it('shows each kind under its own named group, songs first, and says the kind before each name', async () => {
    fakeBackend({
      'GET /library': {
        songs: [{ id: 5, title: 'Friday Song', artist: 'Artist', bpm: null, readiness: { status: 'queued', reason: '' } }],
        total: 1, next: null,
      },
    });
    const commands = [
      make('do-friday', 'Friday action', 'Do'),
      make('go-friday', 'Friday page', 'Go to'),
      make('draft-friday', 'Friday draft', 'Your drafts'),
      make('play-friday', 'Friday playback', 'Playback'),
    ];
    render(<CommandPalette commands={commands} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Friday' } });
    await screen.findByRole('option', { name: /^Song: Friday Song/ });

    const list = screen.getByRole('listbox', { name: 'Results' });
    const groups = within(list).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent))
      .toEqual(['Songs', 'Your drafts', 'Go to', 'Playback', 'Do']);

    const names = within(list).getAllByRole('option').map((option) => option.getAttribute('aria-label') ?? '');
    expect(names[0]).toMatch(/^Song: Friday Song - Artist/);
    expect(names).toContain('Draft: Friday draft');
    expect(names).toContain('Page: Friday page');
    expect(names).toContain('Playback: Friday playback');
    expect(names).toContain('Action: Friday action');
    // searching the whole library is its own kind and always comes last, with no group heading
    expect(names[names.length - 1]).toBe('Search: Search your library for “Friday”');
  });

  it('keeps two results with the same name apart by their kind and their visible group line', () => {
    const commands = [make('draft-same', 'Sunset', 'Your drafts'), make('go-same', 'Sunset', 'Go to')];
    render(<CommandPalette commands={commands} onClose={vi.fn()} />);
    const draft = screen.getByRole('option', { name: 'Draft: Sunset' });
    const page = screen.getByRole('option', { name: 'Page: Sunset' });
    expect(within(draft).getByText('Your drafts')).toBeInTheDocument();
    expect(within(page).getByText('Go to')).toBeInTheDocument();
    expect(draft.closest('[role="group"]')).not.toBe(page.closest('[role="group"]'));
  });
});
