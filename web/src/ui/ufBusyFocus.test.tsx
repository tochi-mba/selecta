import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Action } from './controls';

/** UF-0370-03: a busy control refuses a second press without losing keyboard focus. It stays a
 * focusable button (aria-disabled, never the disabled attribute), says it is busy, and when the slow
 * work finishes the focus is still on it, ready for the next key press. */

describe('busy controls keep focus', () => {
  it('a slow save keeps focus on the button, refuses repeats and hands it back ready', async () => {
    let finish = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<Action run={run} working="Saving…">Save</Action>);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(document.activeElement).toBe(button);
    await act(async () => finish());
    expect(document.activeElement).toBe(button);
    expect(button).not.toHaveAttribute('aria-busy');
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
