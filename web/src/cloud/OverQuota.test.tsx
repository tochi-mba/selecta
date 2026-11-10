import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { blockedByQuota, OverQuotaBanner } from './OverQuota';

describe('the over-quota banner', () => {
  it('names the overage and offers Manage storage and Upgrade', async () => {
    const go = vi.fn();
    render(<OverQuotaBanner account={cloudAccount({ used: 45e9, limit: 10e9 })} go={go} />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('You’re 35.0 GB over Free’s 10.0 GB');
    expect(banner).toHaveTextContent('You can still listen, download and remove songs. Nothing has been deleted.');
    await userEvent.click(screen.getByRole('button', { name: 'Manage storage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(go.mock.calls).toEqual([['library'], ['billing']]);
  });

  it('is not there when the library fits', () => {
    const { container } = render(<OverQuotaBanner account={cloudAccount()} go={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the older account answer without meters too', () => {
    const account = cloudAccount({ used: 11e9, limit: 10e9 });
    delete account.usage;
    render(<OverQuotaBanner account={account} go={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('1.0 GB over');
  });
});

describe('blockedByQuota', () => {
  it('explains why uploads and exports wait, only while over quota', () => {
    expect(blockedByQuota(cloudAccount())).toBeNull();
    expect(blockedByQuota(null)).toBeNull();
    expect(blockedByQuota(cloudAccount({ used: 12e9 }))).toMatch(/2.0 GB over your plan’s storage, so new uploads and exports are paused/);
  });
});
