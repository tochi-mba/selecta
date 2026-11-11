import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../shell/commands';
import { CommandPalette } from './CommandPalette';

const command = (id: string, run = vi.fn()): Command => ({ id, label: id, group: 'Do', run });

function Page({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Something else</button>
      <button type="button" onClick={() => setOpen(true)}>Search</button>
      {open && <CommandPalette commands={commands} onClose={() => setOpen(false)} />}
    </>
  );
}

const openFrom = () => {
  const opener = screen.getByRole('button', { name: 'Search' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

// SF-0244-06: opening puts focus in the search field; every way of closing gives it back to what opened it.
describe('SF-0244-06 the palette returns focus predictably', () => {
  it('opening focuses the search field, and Escape gives focus back to the opener', () => {
    render(<Page commands={[command('First')]} />);
    const opener = openFrom();
    const input = screen.getByRole('combobox', { name: 'Search for a page or a command' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('running a command with Enter closes it and gives focus back to the opener', () => {
    const run = vi.fn();
    render(<Page commands={[command('First', run)]} />);
    const opener = openFrom();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('the close button gives focus back to the opener too, and Tab stays inside while open', () => {
    render(<Page commands={[command('First')]} />);
    const opener = openFrom();
    const dialog = screen.getByRole('dialog', { name: 'Search and commands' });
    for (let i = 0; i < 6; i += 1) {
      fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close Search and commands' }));
    expect(opener).toHaveFocus();
  });
});
