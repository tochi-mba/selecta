import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LUCY_USAGE_EVENT } from '../cloud/lucyUsage';
import { LUCY_WINDOWS } from '../test/cloudAccount';
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
    // the card is titled for the plan, with the plan's Lucy level as its badge
    expect(await screen.findByRole('heading', { name: 'Lucy on your plan' })).toBeInTheDocument();
    expect(screen.getByText('Lucy Standard')).toBeInTheDocument();
    expect(screen.getByText('120 of 440 turns this month', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/resets (1 Dec|Dec 1)/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Lucy turns this month' })).toHaveAttribute('aria-valuenow', '27');
    for (const hidden of [/who does the planning/i, /API key/i, /spending limit/i, /most rounds/i, /most steps/i, /most seconds/i, /I agree to send/i]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    for (const field of [/^model/i, /address/i, /API key/i, /spending/i]) expect(screen.queryByLabelText(field)).toBeNull();
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('spinbutton')).toEqual([]);
    expect(screen.getByLabelText('Use Lucy')).toBeChecked();
    expect(screen.getByText('Share short lyric snippets')).toBeInTheDocument();
    expect(screen.getByText(/text to SelectaDJ’s AI provider/)).toBeInTheDocument();
  });

  it('saves only the person’s own choices', async () => {
    const request = fakeRequest();
    render(<LucyCloudSettings request={request} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Memory and history/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Share a summary of your listening/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved.'));
    const [path, init] = request.mock.calls.at(-1)!;
    expect(path).toBe('/account/lucy');
    expect(init?.method).toBe('PUT');
    expect(Object.keys(JSON.parse(String(init?.body))).sort()).toEqual(['enabled', 'phases', 'privacy']);
    expect(JSON.parse(String(init?.body)).phases.memory).toBe(true);
    expect(JSON.parse(String(init?.body)).privacy.share_history).toBe(true);
  });

  it('leaves out a phase whose feature is off for this account', async () => {
    render(<LucyCloudSettings request={fakeRequest()} features={{ 'lucy.voice': false }} />);
    await screen.findByRole('heading', { name: 'Lucy on your plan' });
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

describe('Lucy settings with the usage read model (ADR-0484)', () => {
  const NEVER_SHOWN = /turn|token|\$|Sonnet|Opus|Haiku|Claude/i;
  /** The page's markup without the ids React makes up afresh for each render. */
  const sameAs = (html: string) => html.replace(/\b(id|for|name|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '');
  const withWindows = (usage_windows: unknown) => vi.fn(async () => ({ ...STATUS, usage_windows })) as never;

  it('keeps the count of turns exactly as it was while the server does not send the new figures', async () => {
    const absent = render(<LucyCloudSettings request={fakeRequest()} />);
    await absent.findByRole('heading', { name: 'Lucy on your plan' });
    expect(absent.getByRole('meter', { name: 'Lucy turns this month' })).toBeInTheDocument();
    expect(absent.queryByRole('meter', { name: 'This week' })).toBeNull();
    const before = sameAs(absent.container.innerHTML);
    absent.unmount();
    // a key that is there but null is the same as no key
    const empty = render(<LucyCloudSettings request={withWindows(null)} />);
    await empty.findByRole('heading', { name: 'Lucy on your plan' });
    expect(sameAs(empty.container.innerHTML)).toBe(before);
  });

  it('shows the two lines in place of the turns once the figures are there, and nothing counted behind them', async () => {
    render(<LucyCloudSettings request={withWindows(LUCY_WINDOWS)} />);
    expect(await screen.findByRole('meter', { name: 'This session' })).toHaveAttribute('aria-valuetext', '72% left, back at 16:40');
    expect(screen.getByRole('meter', { name: 'This week' })).toHaveAttribute('aria-valuetext', '90% left, back Thursday 09:00');
    expect(screen.queryByRole('meter', { name: 'Lucy turns this month' })).toBeNull();
    const usage = document.querySelector('.lucy-usage') as HTMLElement;
    expect(usage.textContent).not.toMatch(NEVER_SHOWN);
    expect(document.querySelector('.lucy-cloud-meter')).toBeNull();
    // the person's own choices are untouched
    expect(screen.getByLabelText('Use Lucy')).toBeChecked();
  });

  it('reads the meter again when the server says the usage moved, keeping unsaved choices', async () => {
    let left = 72;
    const request = vi.fn(async () => ({ ...STATUS, usage_windows: { ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, left } } })) as never;
    render(<LucyCloudSettings request={request} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Share a summary of your listening/ }));
    left = 40;
    window.dispatchEvent(new Event(LUCY_USAGE_EVENT));
    await waitFor(() => expect(screen.getByRole('meter', { name: 'This session' })).toHaveAttribute('aria-valuenow', '40'));
    expect(screen.getByRole('checkbox', { name: /Share a summary of your listening/ })).toBeChecked();
  });
});
