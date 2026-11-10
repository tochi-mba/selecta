import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { Billing } from './Billing';
import { checkoutBody, consentVersionFor, NO_CONSENT, useCheckoutReturn } from './checkout';
import { Meters } from './Meters';

afterEach(() => { window.history.replaceState({}, '', '/'); vi.useRealTimers(); });

const noop = () => {};

describe('the meters', () => {
  it('show storage, analysis today, Lucy turns and exports, each with when it resets', () => {
    render(<Meters account={cloudAccount()} />);
    expect(screen.getByRole('region', { name: 'Storage' })).toHaveTextContent('4.2 GB of 10.0 GB');
    expect(screen.getByRole('region', { name: 'Analysis today' })).toHaveTextContent('12 of 150 songs');
    expect(screen.getByRole('region', { name: 'Analysis today' })).toHaveTextContent(/Resets .*Wed/);
    expect(screen.getByRole('region', { name: 'Lucy turns this month' })).toHaveTextContent('9 of 40 turns');
    expect(screen.getByRole('region', { name: 'Lucy turns this month' })).toHaveTextContent('Resets 1 Dec');
    expect(screen.getByRole('region', { name: 'Exports this month' })).toHaveTextContent('1 of 3 exports');
    expect(screen.getByRole('region', { name: 'Exports this month' })).toHaveTextContent('kept 7 days');
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['42', '8', '23', '33']);
  });

  it('say fair use instead of drawing a bar with no limit', () => {
    const account = cloudAccount({ plan: 'premium' });
    account.usage!.exports_month = { ...account.usage!.exports_month, limit: null };
    render(<Meters account={account} />);
    const exports = screen.getByRole('region', { name: 'Exports this month' });
    expect(exports).toHaveTextContent('1 exports');
    expect(within(exports).queryByRole('progressbar')).toBeNull();
    expect(exports).toHaveTextContent('Fair use');
  });

  it('name the overage and the paused exports when over quota', () => {
    render(<Meters account={cloudAccount({ used: 12 * 1e9 })} />);
    expect(screen.getByRole('region', { name: 'Storage' })).toHaveTextContent('2.0 GB over your plan');
    expect(screen.getByRole('region', { name: 'Exports this month' })).toHaveTextContent('Paused while you are over your storage limit');
  });
});

describe('checkout consent', () => {
  it('keeps the plan buttons off until all three consents are ticked, then sends them', async () => {
    const onCheckout = vi.fn();
    render(<Billing account={cloudAccount()} busy={false} phase="idle" consentVersion="terms-2026-11" onCheckout={onCheckout} onPortal={noop} />);
    const premium = screen.getByRole('button', { name: 'Choose Premium' });
    expect(premium).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I agree to the subscription terms.'));
    await userEvent.click(screen.getByLabelText('I ask for access to start immediately.'));
    expect(premium).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/14-day cancellation right/));
    expect(premium).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Annual' }));
    await userEvent.click(premium);
    expect(onCheckout).toHaveBeenCalledWith('premium', 'year', { terms: true, immediate: true, cancellation: true });
    expect(screen.getByText('Consent wording version terms-2026-11')).toBeInTheDocument();
  });

  it('refuses to offer checkout without a consent version', () => {
    render(<Billing account={cloudAccount()} busy={false} phase="idle" consentVersion="" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByText('Checkout isn’t set up for this site yet.')).toBeInTheDocument();
  });

  it('builds the request with the consent version and each acknowledgement', () => {
    expect(checkoutBody('standard', 'month', { terms: true, immediate: true, cancellation: false }, 'v7')).toEqual({
      plan: 'standard', interval: 'month', consent_version: 'v7',
      accepted_terms: true, requested_immediate_access: true, acknowledged_cancellation_right: false,
    });
    expect(NO_CONSENT).toEqual({ terms: false, immediate: false, cancellation: false });
  });

  it('prefers the server’s consent version over the one the site was built with', () => {
    expect(consentVersionFor(cloudAccount(), 'built-in')).toBe('terms-2026-11');
    expect(consentVersionFor({ ...cloudAccount(), billing: { consent_version: '' } }, 'built-in')).toBe('built-in');
    expect(consentVersionFor(null, 'built-in')).toBe('built-in');
  });

  it('sends a paid plan to the portal to upgrade, downgrade or cancel', async () => {
    const onPortal = vi.fn();
    render(<Billing account={cloudAccount({ plan: 'standard' })} busy={false} phase="idle" consentVersion="v" onCheckout={noop} onPortal={onPortal} />);
    expect(screen.queryByRole('button', { name: /Choose/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Change plan or cancel' }));
    expect(onPortal).toHaveBeenCalled();
  });
});

describe('coming back from Checkout', () => {
  it('never says the plan changed while the snapshot is still Free', () => {
    render(<Billing account={cloudAccount()} busy={false} phase="confirming" consentVersion="v" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByRole('status')).toHaveTextContent('Confirming your payment…');
    expect(screen.queryByText(/You’re on/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Choose/ })).toBeNull();
  });

  it('confirms only once the account answer shows the new plan', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/account/billing?checkout=success&session_id=cs_1');
    const refresh = vi.fn(async () => {});
    const { result, rerender } = renderHook(({ account }) => useCheckoutReturn(account, refresh, { everyMs: 100, tries: 50 }), { initialProps: { account: cloudAccount() } });
    expect(result.current).toBe('confirming');
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(result.current).toBe('confirming');
    rerender({ account: cloudAccount({ plan: 'premium' }) });
    expect(result.current).toBe('confirmed');
    expect(window.location.search).toBe('');
    render(<Billing account={cloudAccount({ plan: 'premium' })} busy={false} phase="confirmed" consentVersion="v" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re on Premium.');
  });

  it('says it is still confirming after a long wait, rather than guessing', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/account/billing?checkout=success');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount(), async () => {}, { everyMs: 10, tries: 3 }));
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe('slow');
  });

  it('says a cancelled checkout changed nothing', () => {
    window.history.replaceState({}, '', '/account/billing?checkout=cancelled');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount(), async () => {}));
    expect(result.current).toBe('cancelled');
  });
});

describe('Plan & billing with a way to change plan switched off', () => {
  it('drops checkout for a Free account, and the portal for a paid one', () => {
    const free = { ...cloudAccount(), features: { 'billing.checkout': false } };
    const { unmount } = render(<Billing account={free} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(screen.queryByText('Before subscribing')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Choose / })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Free' })).toBeInTheDocument();
    unmount();
    const paid = { ...cloudAccount({ plan: 'premium' }), features: { 'billing.portal': false } };
    render(<Billing account={paid} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(screen.queryByRole('button', { name: 'Change plan or cancel' })).toBeNull();
    expect(screen.queryByText(/Stripe portal/)).toBeNull();
  });

  it('never names Lucy or exports when they are off, nor rooms when a rule switched them off', () => {
    const account = { ...cloudAccount(), features: { lucy: false, export: false, rooms: false } };
    render(<Billing account={account} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(document.body.textContent).not.toMatch(/Lucy|Exports this month|request rooms/);
  });
});
