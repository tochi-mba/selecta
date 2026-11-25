import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cloudAccount, LUCY_WINDOWS } from '../test/cloudAccount';
import { Meters, StorageMeter, storageMode } from './Meters';

/** BF-0464-02 / BF-0456-06: the meters read the payload's top-level `storage_mode`. */
function withMode(mode: 'hosted' | 'none' | undefined, overrides: Parameters<typeof cloudAccount>[0] = {}) {
  const account = cloudAccount(overrides);
  if (mode !== undefined) (account.usage as unknown as Record<string, unknown>).storage_mode = mode;
  return account;
}

describe('storage meter by storage_mode', () => {
  it('shows no storage, analysis or export meters for "none": only what the account uses', () => {
    const account = withMode('none', { used: 0, limit: 0 });
    account.usage!.exports_month = { ...account.usage!.exports_month, blocked: true };
    render(<Meters account={account} />);
    expect(screen.queryByRole('region', { name: 'Storage' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Analysis today' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Exports this month' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Lucy turns this month' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/storage|GB|0 B/i);
  });

  it('keeps the hosted meter exactly as before for "hosted"', () => {
    render(<Meters account={withMode('hosted')} />);
    const storage = screen.getByRole('region', { name: 'Storage' });
    expect(storage).toHaveTextContent('4.2 GB of 10.0 GB');
    expect(within(storage).getByRole('meter')).toHaveAttribute('aria-valuenow', '42');
  });

  it('treats a server that does not say as hosted, and still warns when over quota', () => {
    const account = withMode(undefined, { used: 12 * 1e9 });
    expect(storageMode(account)).toBe('hosted');
    render(<StorageMeter account={account} />);
    expect(screen.getByRole('region', { name: 'Storage' })).toHaveTextContent('2.0 GB over your plan');
  });
});

describe('the Lucy line with the usage read model (ADR-0484)', () => {
  const NEVER_SHOWN = /turn|token|\$|Sonnet|Opus|Haiku|Claude/i;

  /** The page's markup without the ids React makes up afresh for each render. */
  const sameAs = (html: string) => html.replace(/\b(id|for|name|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '');
  it('is the count of turns, exactly as before, while the server does not send the new figures', () => {
    const absent = render(<Meters account={cloudAccount()} />);
    expect(absent.getByRole('region', { name: 'Lucy turns this month' })).toHaveTextContent('9 of 40 turns');
    expect(absent.queryByRole('region', { name: 'Lucy usage' })).toBeNull();
    const before = sameAs(absent.container.innerHTML);
    absent.unmount();
    const account = cloudAccount();
    account.usage!.lucy_windows = null;
    expect(sameAs(render(<Meters account={account} />).container.innerHTML)).toBe(before);
  });

  it('shows what is left of the session and the week in its place, and nothing counted behind them', () => {
    render(<Meters account={cloudAccount({ lucyWindows: LUCY_WINDOWS })} />);
    expect(screen.queryByRole('region', { name: 'Lucy turns this month' })).toBeNull();
    const lucy = screen.getByRole('region', { name: 'Lucy usage' });
    expect(within(lucy).getByRole('meter', { name: 'This session' })).toHaveAttribute('aria-valuetext', '72% left, back at 16:40');
    expect(within(lucy).getByRole('meter', { name: 'This week' })).toHaveAttribute('aria-valuetext', '90% left, back Thursday 09:00');
    expect(lucy.textContent).not.toMatch(NEVER_SHOWN);
    // the other meters are as they were
    expect(screen.getByRole('region', { name: 'Storage' })).toHaveTextContent('4.2 GB of 10.0 GB');
    expect(screen.getByRole('region', { name: 'Exports this month' })).toHaveTextContent('1 of 3 exports');
  });

  it('stays hidden with Lucy off, whatever the server sends', () => {
    const account = cloudAccount({ lucyWindows: LUCY_WINDOWS });
    account.features = { lucy: false };
    render(<Meters account={account} />);
    expect(screen.queryByRole('region', { name: 'Lucy usage' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lucy turns this month' })).toBeNull();
  });
});
