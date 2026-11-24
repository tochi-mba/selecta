import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CloudLucy, LucyCloudSettings, LucyTurnsMeter } from './LucyCloudSettings';

// Walked on the Cloud site with a keyboard (2026-11-24): pressing Save changes dropped the focus
// to the top of the page, a card that could not load had no way to try again, a full turns meter
// said nothing in words, and a save was announced twice.

const STATUS: CloudLucy = {
  enabled: true,
  phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
  privacy: { share_lyrics: false, share_history: false },
  tier: 'Lucy Standard',
  usage: { used: 120, limit: 440, fair_use: false, resets_at: Date.UTC(2026, 11, 1) / 1000 },
};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const answering = (put?: () => Promise<unknown>) => vi.fn(async (_path: string, init?: RequestInit) => {
  if (init?.method === 'PUT' && put) return put();
  return init?.body ? { ...STATUS, ...JSON.parse(String(init.body)) } : STATUS;
}) as unknown as Request & { mock: { calls: unknown[][] } };

describe('Lucy settings in Cloud, with a keyboard and a screen reader', () => {
  it('keeps the focus on Save changes through a save that works', async () => {
    render(<LucyCloudSettings request={answering()} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Memory and history/ }));
    const save = screen.getByRole('button', { name: 'Save changes' });
    save.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('All changes saved.')).toBeInTheDocument());
    expect(save).toHaveFocus();
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the focus on Save changes when the save fails, and says why once', async () => {
    const request = answering(async () => { throw new Error('SelectaDJ couldn’t be reached. Try again.'); });
    render(<LucyCloudSettings request={request} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Memory and history/ }));
    const save = screen.getByRole('button', { name: 'Save changes' });
    save.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes were not saved. SelectaDJ couldn’t be reached. Try again.');
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute('aria-disabled');
  });

  it('does not send anything when Save changes is pressed with nothing changed', async () => {
    const request = answering();
    render(<LucyCloudSettings request={request} />);
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(save);
    expect(request.mock.calls).toHaveLength(1);
  });

  it('offers Try again when the settings could not be loaded', async () => {
    let fail = true;
    const request = vi.fn(async () => { if (fail) throw new Error('SelectaDJ’s service isn’t answering right now.'); return STATUS; }) as unknown as Request;
    render(<LucyCloudSettings request={request} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Lucy’s settings could not be loaded.');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: 'Use Lucy' })).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says in words that the month’s turns are used up, and when they start again', () => {
    const { rerender } = render(<LucyTurnsMeter usage={{ used: 175, limit: 175, fair_use: false, resets_at: Date.UTC(2026, 11, 1) / 1000 }} />);
    expect(screen.getByRole('note')).toHaveTextContent(/used all of this month’s turns, so Lucy can’t take a new request yet\. They start again on (1 Dec|Dec 1)\./);
    rerender(<LucyTurnsMeter usage={{ used: 174, limit: 175, fair_use: false, resets_at: null }} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
