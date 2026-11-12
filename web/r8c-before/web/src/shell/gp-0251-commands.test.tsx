import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../ui/CommandPalette';
import { Command, foldForSearch, matchCommands } from './commands';

/** GP-0251-06: the command palette finds things the way the Library's search does, and nothing in it
 * runs until someone chooses it. */

const command = (id: string, label: string, run = vi.fn()): Command => ({ id, label, group: 'Your drafts', run }) as Command;

describe('GP-0251-06 palette results match the way the Library search does', () => {
  it('folds case, accents, letters like ø and ł, punctuation and credits like the server', () => {
    expect(foldForSearch('Café del Mar')).toBe('cafe del mar');
    expect(foldForSearch('Ørsted & Łódź')).toBe('orsted lodz');
    expect(foldForSearch('Song (ft. Someone)')).toBe('song feat someone');
    expect(foldForSearch('Song featuring Someone')).toBe('song feat someone');
  });

  it('finds an accented or punctuated name typed plainly, and never changes what is shown', () => {
    const commands = [command('a', 'Edit draft: Café del Mar'), command('b', 'Edit draft: Beyoncé, live'), command('c', 'Edit draft: Friday')];
    expect(matchCommands(commands, 'cafe').map((found) => found.id)).toEqual(['a']);
    expect(matchCommands(commands, 'beyonce live').map((found) => found.id)).toEqual(['b']);
    expect(matchCommands(commands, 'CAFÉ').map((found) => found.label)).toEqual(['Edit draft: Café del Mar']);
  });

  it('runs nothing while typing, and Enter runs only the highlighted result', () => {
    const cafe = vi.fn();
    const friday = vi.fn();
    render(<CommandPalette commands={[command('a', 'Edit draft: Café del Mar', cafe), command('c', 'Edit draft: Friday', friday)]} onClose={() => {}} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'cafe' } });
    fireEvent.change(box, { target: { value: 'cafe del' } });
    expect(cafe).not.toHaveBeenCalled();
    expect(friday).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(cafe).toHaveBeenCalledTimes(1);
    expect(friday).not.toHaveBeenCalled();
  });
});
