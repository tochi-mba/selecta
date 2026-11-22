import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
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
