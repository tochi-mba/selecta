import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account, BillingStanding } from './api';
import { BillingStandingNotice, fingerprint, standingWords } from './BillingStanding';

const AT = Date.UTC(2026, 11, 4, 12) / 1000;

function account(standing: BillingStanding | null, features: Record<string, boolean> = {}): Account {
  return {
    user: { id: 'u', email: 'a@example.com', email_verified: true },
    workspace: { id: 'w', name: 'Mine', role: 'owner' },
    entitlement: { plan: 'standard', plan_version: 1, storage_limit_bytes: 0, storage_used_bytes: 0, storage_state: 'ok' },
    billing: { consent_version: '1', standing },
    features: { 'billing.standing': true, 'billing.portal': true, ...features },
    feature_locks: {},
  };
}

const failed: BillingStanding = { state: 'payment_failed', plan_label: 'Standard', at: AT, key: 'payment_failed:sub_1:1', can_manage: true };

afterEach(() => localStorage.clear());

describe('billing moments', () => {
  it('says each moment in plain words with its date', () => {
    expect(standingWords(failed, 'UTC').text).toMatch(/^We couldn’t take your last payment\. Your Standard plan stays until .*2026.*\. Update your card to keep it\.$/);
    expect(standingWords({ ...failed, state: 'cancelling' }, 'UTC').text).toMatch(/^Your Standard plan ends on .+\. After that you’re on Free\.$/);
    expect(standingWords({ ...failed, state: 'ended_payment_failed' }, 'UTC').text).toMatch(/because payment failed\. Your music and mixes are still here\.$/);
    expect(standingWords({ ...failed, state: 'action_required', at: null }, 'UTC').text).toMatch(/confirm your payment for Standard/);
  });

  it('opens the portal from the notice, and stays dismissed for that event only', () => {
    const portal = vi.fn();
    const { rerender } = render(<BillingStandingNotice account={account(failed)} place="shell" onPortal={portal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update card' }));
    expect(portal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Contact support' }).getAttribute('href')).toMatch(/^mailto:support@selectadj\.app\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    // storage keeps a one-way fingerprint, never the event key itself
    const stored = Object.keys(localStorage).map((name) => localStorage.getItem(name) ?? '').join(' ');
    expect(stored).not.toContain(failed.key);
    expect(stored).not.toContain('payment');
    expect(stored).toContain(fingerprint(failed.key));
    rerender(<BillingStandingNotice account={account(failed)} place="shell" onPortal={portal} />);
    expect(screen.queryByRole('alert')).toBeNull();
    // a new event (cancelling) has a new key and shows again
    rerender(<BillingStandingNotice key="next" account={account({ ...failed, state: 'cancelling', key: 'cancelling:sub_1:2' })} place="shell" onPortal={portal} />);
    expect(screen.getByRole('button', { name: 'Keep my plan' })).toBeTruthy();
  });

  it('tells a member who cannot manage billing who can, and shows nothing with the flag off', () => {
    const { rerender, container } = render(<BillingStandingNotice account={account({ ...failed, can_manage: false })} place="billing" onPortal={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Update card' })).toBeNull();
    expect(screen.getByText('The workspace owner can update the payment details.')).toBeTruthy();
    rerender(<BillingStandingNotice account={account(failed, { 'billing.standing': false })} place="billing" onPortal={() => undefined} />);
    expect(container.textContent).toBe('');
  });
});
