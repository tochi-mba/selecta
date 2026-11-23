import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { CloudError } from './api';
import { Billing, yearlyComparison } from './Billing';
import { checkoutAvailable, checkoutBody, checkoutProblem, consentVersionFor, NO_CONSENT, useCheckoutReturn } from './checkout';
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
    expect(screen.getByRole('region', { name: 'Lucy turns this month' })).toHaveTextContent(/Resets (1 Dec|Dec 1)/);
    expect(screen.getByRole('region', { name: 'Exports this month' })).toHaveTextContent('1 of 3 exports');
    expect(screen.getByRole('region', { name: 'Exports this month' })).toHaveTextContent('kept 7 days');
    const bars = screen.getAllByRole('meter');
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['42', '8', '23', '33']);
  });

  it('say fair use instead of drawing a bar with no limit', () => {
    const account = cloudAccount({ plan: 'premium' });
    account.usage!.exports_month = { ...account.usage!.exports_month, limit: null };
    render(<Meters account={account} />);
    const exports = screen.getByRole('region', { name: 'Exports this month' });
    expect(exports).toHaveTextContent('1 exports');
    expect(within(exports).queryByRole('meter')).toBeNull();
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

  it('still confirms when the plan arrives after it said the payment was slow', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/account/billing?checkout=success');
    const { result, rerender } = renderHook(({ account }) => useCheckoutReturn(account, async () => {}, { everyMs: 10, tries: 3 }), { initialProps: { account: cloudAccount() } });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe('slow');
    rerender({ account: cloudAccount({ plan: 'premium' }) });
    expect(result.current).toBe('confirmed');
    expect(window.location.search).toBe('');
  });

  it('says a cancelled checkout changed nothing', () => {
    window.history.replaceState({}, '', '/account/billing?checkout=cancelled');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount(), async () => {}));
    expect(result.current).toBe('cancelled');
  });
});

describe('a checkout that could not start', () => {
  const draw = (props: Partial<Parameters<typeof Billing>[0]> = {}) => render(<Billing account={cloudAccount()} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} {...props} />);

  it('says why beside the button, as an alert, and the button is back to normal', () => {
    draw({ error: checkoutProblem(new CloudError('x', 503, 'billing_not_configured')) });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Upgrades aren’t available right now. Nothing was charged. Try again later.');
    // in the hint slot, in the same row as the button it is about
    expect(within(alert.parentElement!).getByRole('button', { name: 'Continue with Premium' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/billing.not.configured/i);
  });

  it('gives every billing refusal plain words, never its code', () => {
    const said = (code: string) => checkoutProblem(new CloudError(code.replaceAll('_', ' '), 503, code));
    expect(said('price_unavailable')).toBe('Upgrades aren’t available right now. Nothing was charged. Try again later.');
    expect(said('billing_misconfigured')).toBe('Upgrades aren’t available right now. Nothing was charged. Try again later.');
    expect(said('billing_temporarily_unavailable')).toBe('The payment service didn’t answer. Nothing was charged. Try again in a moment.');
    expect(said('subscription_exists')).toBe('This workspace already has a plan. Manage it from the billing portal.');
    expect(said('billing_customer_not_found')).toBe('There’s no billing record for this workspace yet.');
    expect(said('untrusted_origin')).toBe('This address isn’t allowed to start a payment.');
    expect(said('untrusted_return_url')).toBe('This address isn’t allowed to start a payment.');
    expect(said('consent_required')).toBe('Tick all three boxes to continue.');
    expect(said('billing_not_permitted')).toBe('Only the workspace owner can change the plan.');
    expect(said('consent_version_changed')).toMatch(/terms have just been updated/);
    // a code with no sentence of its own, and a raw network failure, are never shown as they came
    expect(said('some_new_code')).toBe('SelectaDJ couldn’t start the payment. Nothing was charged. Try again in a moment.');
    expect(checkoutProblem(new TypeError('Failed to fetch'))).not.toMatch(/failed to fetch/i);
  });

  it('when the site cannot start a payment, shows the plans to read with one quiet line and no form', () => {
    draw({ account: { ...cloudAccount(), billing: { consent_version: 'v1', checkout_available: false } } });
    expect(screen.getByTestId('upgrades-not-open')).toHaveTextContent('Upgrades aren’t open yet on this site.');
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(screen.queryByText('Before subscribing')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Continue with/ })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/Upgrade whenever you like/)).toBeNull();
  });

  it('an older server that does not say is treated as able to, as before', () => {
    expect(checkoutAvailable({ ...cloudAccount(), billing: { consent_version: 'v1' } })).toBe(true);
    expect(checkoutAvailable({ ...cloudAccount(), billing: undefined })).toBe(true);
    draw();
    expect(screen.getByText('Before subscribing')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});

describe('the annual price', () => {
  it('says what it comes to a month and what it saves, from the two prices', () => {
    expect(yearlyComparison('£6.99 / month', '£59 / year')).toBe('£4.92 a month, billed yearly. Save £24.88.');
    expect(yearlyComparison('£12.99 / month', '£109 / year')).toBe('£9.08 a month, billed yearly. Save £46.88.');
  });

  it('claims no saving when there is none, and says nothing when a price cannot be read', () => {
    expect(yearlyComparison('£5 / month', '£60 / year')).toBe('£5.00 a month, billed yearly.');
    expect(yearlyComparison('£5 / month', '£72 / year')).toBe('£6.00 a month, billed yearly.');
    expect(yearlyComparison('', '£59 / year')).toBeNull();
    expect(yearlyComparison('£6.99 / month', 'Ask us')).toBeNull();
    expect(yearlyComparison('$6.99 / month', '£59 / year')).toBeNull();
  });

  it('shows under each card only when Annual is chosen', async () => {
    render(<Billing account={cloudAccount()} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(screen.queryByText(/billed yearly/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Annual' }));
    expect(screen.getByText('£4.92 a month, billed yearly. Save £24.88.')).toBeInTheDocument();
    expect(screen.getByText('£9.08 a month, billed yearly. Save £46.88.')).toBeInTheDocument();
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

describe('Plan & billing for a local-first account (BF-0464-03)', () => {
  const localFirst = (features: Record<string, boolean> = {}, locks: Record<string, string> = {}) =>
    ({ ...cloudAccount(), experience: { local_first: true, hosted: false }, features, feature_locks: locks });

  it('sells Rooms, Lucy, devices and discovery with no storage headline, at the same prices', async () => {
    render(<Billing account={localFirst()} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    const standard = screen.getByRole('region', { name: 'Standard' });
    const premium = screen.getByRole('region', { name: 'Premium' });
    expect(standard).toHaveTextContent('£6.99 / month');
    expect(premium).toHaveTextContent('£12.99 / month');
    for (const card of [standard, premium]) {
      expect(card).not.toHaveTextContent(/\bGB\b|storage|library/i);
      expect(card).toHaveTextContent('Lucy');
      expect(card).toHaveTextContent('Discovery');
      expect(card).toHaveTextContent('Devices');
    }
    expect(premium).toHaveTextContent('Rooms');
    expect(standard).not.toHaveTextContent('Rooms');
    await userEvent.click(screen.getByRole('button', { name: 'Annual' }));
    expect(standard).toHaveTextContent('£59 / year');
    expect(premium).toHaveTextContent('£109 / year');
  });

  it('keeps the hosted cards for a hosted account, and for one that holds both', () => {
    const both = { ...cloudAccount(), experience: { local_first: true, hosted: true } };
    render(<Billing account={both} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByRole('region', { name: 'Standard' })).toHaveTextContent('50 GB');
  });

  it('an explicit localFirst prop wins over the account read', () => {
    render(<Billing account={cloudAccount()} localFirst busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByRole('region', { name: 'Standard' })).not.toHaveTextContent('50 GB');
  });

  it('never names Lucy or Rooms when they are off, and shows Rooms as a teaser when plan-locked', () => {
    const { unmount } = render(<Billing account={localFirst({ lucy: false, rooms: false })} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(document.body.textContent).not.toMatch(/Lucy|Rooms/);
    unmount();
    render(<Billing account={localFirst({ rooms: false }, { rooms: 'premium' })} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByRole('region', { name: 'Premium' })).toHaveTextContent('Rooms');
  });

  it('does not tie a paid downgrade or a pause to library size', () => {
    render(<Billing account={{ ...localFirst(), entitlement: { ...cloudAccount({ plan: 'standard' }).entitlement } }} blocked busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(document.body.textContent).not.toMatch(/bigger than the new plan|lifts the pause on uploads/);
  });
});
