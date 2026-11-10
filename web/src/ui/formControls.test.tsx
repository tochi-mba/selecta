import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combobox, Select, TextField } from './formControls';
import { IconButton, Slider } from './primitives';
import { Action } from './controls';

/** T0030: the shared button, icon button, text input, combobox, select and slider are labelled and show their state. */
describe('shared form controls (T0030)', () => {
  it('buttons and icon buttons have names, and a busy button says so', async () => {
    render(<><Action run={() => new Promise(() => {})} working="Saving…">Save</Action><IconButton icon="close" label="Close the panel" /></>);
    expect(screen.getByRole('button', { name: 'Close the panel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('a text field joins its label, help and error to the box', () => {
    const changed = vi.fn();
    render(<TextField label="Mix name" help="Shown on the export" error="A name is needed" value="" onChange={changed} required />);
    const box = screen.getByRole('textbox', { name: 'Mix name' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAttribute('aria-required', 'true');
    expect(box).toHaveAccessibleDescription('Shown on the export A name is needed');
    fireEvent.change(box, { target: { value: 'Sunday' } });
    expect(changed).toHaveBeenCalledWith('Sunday');
  });

  it('a select is labelled, reports its choice and respects disabled', () => {
    const changed = vi.fn();
    render(<Select label="Energy" value="calm" onChange={changed} options={[{ value: 'calm', label: 'Calm' }, { value: 'lift', label: 'Lift' }]} />);
    const select = screen.getByRole('combobox', { name: 'Energy' });
    expect(select).toHaveValue('calm');
    expect(select).not.toHaveAttribute('aria-invalid');
    fireEvent.change(select, { target: { value: 'lift' } });
    expect(changed).toHaveBeenCalledWith('lift');
    render(<Select label="Locked" value="a" onChange={changed} disabled options={[{ value: 'a', label: 'A' }]} />);
    expect(screen.getByRole('combobox', { name: 'Locked' })).toBeDisabled();
  });

  it('a slider speaks its value in words', () => {
    render(<Slider label="Storage limit" valueText="about 8 GB" min={1} max={16} defaultValue={8} />);
    expect(screen.getByRole('slider', { name: 'Storage limit' })).toHaveAttribute('aria-valuetext', 'about 8 GB');
  });

  it('a combobox suggests, moves by arrow key, picks with Enter and closes with Escape', () => {
    const picked = vi.fn();
    function Harness() {
      const [text, setText] = useState('');
      return <Combobox label="Song" value={text} onChange={setText} onPick={picked} options={[{ value: '1', label: 'Alpha' }, { value: '2', label: 'Beta' }]} />;
    }
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Song' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const first = screen.getByRole('option', { name: 'Alpha' });
    expect(box).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(picked).toHaveBeenCalledWith('2');
    expect(box).toHaveValue('Beta');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
  });
});
