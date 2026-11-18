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
  it('shows the truthful no-hosted-storage line for "none", with no bar and no quota warning', () => {
    const account = withMode('none', { used: 0, limit: 0 });
    render(<Meters account={account} />);
    const storage = screen.getByRole('region', { name: 'Storage' });
    expect(storage).toHaveTextContent('No hosted storage');
    expect(storage).toHaveTextContent('Your music stays on your own devices');
    expect(within(storage).queryByRole('meter')).toBeNull();
    expect(storage).not.toHaveClass('warn');
    expect(document.body.textContent).not.toMatch(/0 B of 0 B|over your plan|0 B free/);
  });

  it('never says exports are paused for storage when there is no hosted storage', () => {
    const account = withMode('none', { used: 0, limit: 0 });
    account.usage!.exports_month = { ...account.usage!.exports_month, blocked: true };
    render(<Meters account={account} />);
    expect(screen.getByRole('region', { name: 'Exports this month' })).not.toHaveTextContent('storage limit');
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
