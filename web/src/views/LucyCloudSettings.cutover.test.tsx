import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LUCY_WINDOWS } from '../test/cloudAccount';
import { CloudLucy, LucyCloudSettings } from './LucyCloudSettings';

/** ADR-0487 rule 11: before an account's switch, the settings page says what changes on the date
 * and that the price does not. */

const STATUS: CloudLucy = {
  enabled: true,
  phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
  privacy: { share_lyrics: false, share_history: false },
  tier: 'Lucy Standard',
  usage: { used: 120, limit: 440, fair_use: false, resets_at: Date.UTC(2026, 11, 1) / 1000 },
};
// midnight on 1 December 2026 in Auckland, which is still 30 November in UTC and in London
const SWITCH = { at: Date.UTC(2026, 10, 30, 11, 0) / 1000, time_zone: 'Pacific/Auckland' };
const answering = (status: unknown) => vi.fn(async () => status) as never;

describe('the note before Lucy’s allowance changes', () => {
  it('says the date in the account’s own time zone, what changes and that the price stays the same', async () => {
    render(<LucyCloudSettings request={answering({ ...STATUS, usage_cutover: SWITCH })} />);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(/Lucy’s allowance changes on (1 December 2026|December 1, 2026)\./);
    expect(note).toHaveTextContent('In place of turns a month, you’ll have a share for each five-hour session and a share for each week.');
    expect(note).toHaveTextContent('The price of your plan stays the same.');
    expect(note.textContent).not.toMatch(/\u2014|'/);
  });

  it('puts the note above the meter, which still counts turns until the date', async () => {
    render(<LucyCloudSettings request={answering({ ...STATUS, usage_cutover: SWITCH })} />);
    const note = await screen.findByRole('note');
    const meter = screen.getByRole('meter', { name: 'Lucy turns this month' });
    expect(note.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says nothing when the server names no switch', async () => {
    render(<LucyCloudSettings request={answering(STATUS)} />);
    await screen.findByRole('heading', { name: 'Lucy on your plan' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/allowance changes/)).toBeNull();
  });

  it('says nothing once the account is on the new allowance', async () => {
    render(<LucyCloudSettings request={answering({ ...STATUS, usage_windows: LUCY_WINDOWS, usage_cutover: SWITCH })} />);
    await screen.findByRole('meter', { name: 'This week' });
    expect(screen.queryByText(/allowance changes/)).toBeNull();
  });
});
