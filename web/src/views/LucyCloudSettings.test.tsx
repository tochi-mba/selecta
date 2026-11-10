import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CloudLucy, LucyCloudSettings } from './LucyCloudSettings';

const STATUS: CloudLucy = {
  enabled: true,
  phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
  privacy: { share_lyrics: false, share_history: false },
  tier: 'Lucy Standard',
  usage: { used: 120, limit: 440, fair_use: false, resets_at: Date.UTC(2026, 11, 1) / 1000 },
};

function fakeRequest() {
  return vi.fn(async (_path: string, init?: RequestInit) => (init?.body ? { ...STATUS, ...JSON.parse(String(init.body)) } : STATUS)) as unknown as (<T>(path: string, init?: RequestInit) => Promise<T>) & { mock: { calls: [string, RequestInit?][] } };
}

describe('Lucy settings in Cloud', () => {
  it('shows the plan’s Lucy level and this month’s turns, not a provider, model, key or limits', async () => {
    render(<LucyCloudSettings request={fakeRequest()} />);
    expect(await screen.findByRole('heading', { name: 'Lucy Standard' })).toBeInTheDocument();
    expect(screen.getByText('120 of 440 turns this month')).toBeInTheDocument();
    expect(screen.getByText(/resets 1 Dec/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Lucy turns this month' })).toHaveAttribute('aria-valuenow', '27');
    for (const hidden of [/who does the planning/i, /API key/i, /spending limit/i, /most rounds/i, /most steps/i, /most seconds/i, /I agree to send/i]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    for (const field of [/^model/i, /address/i, /API key/i, /spending/i]) expect(screen.queryByLabelText(field)).toBeNull();
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('spinbutton')).toEqual([]);
    expect(screen.getByLabelText('Use Lucy')).toBeChecked();
    expect(screen.getByText('Share short lyric snippets')).toBeInTheDocument();
    expect(screen.getByText(/text to Selecta’s AI provider/)).toBeInTheDocument();
  });

  it('saves only the person’s own choices', async () => {
    const request = fakeRequest();
    render(<LucyCloudSettings request={request} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Memory and history/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Share a summary of your listening/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Lucy settings' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'));
    const [path, init] = request.mock.calls.at(-1)!;
    expect(path).toBe('/account/lucy');
    expect(init?.method).toBe('PUT');
    expect(Object.keys(JSON.parse(String(init?.body))).sort()).toEqual(['enabled', 'phases', 'privacy']);
    expect(JSON.parse(String(init?.body)).phases.memory).toBe(true);
    expect(JSON.parse(String(init?.body)).privacy.share_history).toBe(true);
  });

  it('leaves out a phase whose feature is off for this account', async () => {
    render(<LucyCloudSettings request={fakeRequest()} features={{ 'lucy.voice': false }} />);
    await screen.findByRole('heading', { name: 'Lucy Standard' });
    expect(screen.queryByRole('checkbox', { name: /Voice input/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Proposals/ })).toBeInTheDocument();
  });

  it('says fair use for a plan whose quick turns are not limited', async () => {
    const request = vi.fn(async () => ({ ...STATUS, usage: { used: 3, limit: null, fair_use: true, resets_at: null } })) as never;
    render(<LucyCloudSettings request={request} />);
    expect(await screen.findByText('3 turns this month')).toBeInTheDocument();
    expect(screen.getByText(/fair use/)).toBeInTheDocument();
  });
});
