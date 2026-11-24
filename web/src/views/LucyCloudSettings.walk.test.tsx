import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CloudLucy, LucyCloudSettings, plainProblem } from './LucyCloudSettings';

// Found walking the card on the local Cloud stack (2026-11-24): a failed read or save showed the
// server's bare "Internal Server Error", and after Try again worked the keyboard's focus fell to
// the top of the page with the button that held it.

const STATUS: CloudLucy = {
  enabled: true,
  phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
  privacy: { share_lyrics: false, share_history: false },
  tier: 'Lucy Standard',
  usage: { used: 1, limit: 10, fair_use: false, resets_at: null },
};

type Req = <T>(path: string, init?: RequestInit) => Promise<T>;

describe('the Cloud Lucy card after a failure', () => {
  it('says a bare server error in plain words, and keeps a reason the server gave', () => {
    expect(plainProblem(new Error('Internal Server Error'))).toBe('SelectaDJ couldn’t do that just now. Try again in a moment.');
    expect(plainProblem(new Error(''))).toBe('SelectaDJ couldn’t do that just now. Try again in a moment.');
    expect(plainProblem(new Error('Your plan doesn’t include Lucy.'))).toBe('Your plan doesn’t include Lucy.');
  });

  it('shows plain words when a save fails', async () => {
    const request = (async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new Error('Internal Server Error');
      return STATUS;
    }) as Req;
    render(<LucyCloudSettings request={request} />);
    await userEvent.click(await screen.findByLabelText(/Share short lyric snippets/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your changes were not saved. SelectaDJ couldn’t do that just now.');
    expect(alert).not.toHaveTextContent('Internal Server Error');
  });

  it('puts the focus on the card’s title once Try again has worked', async () => {
    let fail = true;
    const request = (async () => {
      if (fail) throw new Error('Internal Server Error');
      return STATUS;
    }) as Req;
    render(<LucyCloudSettings request={request} />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal Server Error');
    fail = false;
    retry.focus();
    await userEvent.keyboard('{Enter}');
    const title = await screen.findByRole('heading', { name: 'Lucy on your plan' });
    await waitFor(() => expect(title).toHaveFocus());
  });
});
