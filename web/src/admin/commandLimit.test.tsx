import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command, COMMAND_LIMIT_MS } from './parts';

afterEach(() => { vi.useRealTimers(); });

describe('a staff command that never answers (T-20261125-8583)', () => {
  it('frees its button after the limit and says the change may still have been made', async () => {
    vi.useFakeTimers();
    render(<Command label="Pause account" run={() => new Promise(() => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause account' }));
    fireEvent.change(screen.getByLabelText(/Reason for/), { target: { value: 'support ticket' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Pause account' }));
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(COMMAND_LIMIT_MS + 10); });
    expect(screen.getByRole('button', { name: 'Pause account' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/may still have been made/);
  });
});
