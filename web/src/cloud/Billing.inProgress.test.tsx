import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { CloudError } from './api';
import { Billing } from './Billing';
import { checkoutBody, checkoutProblem } from './checkout';

// Back from Stripe, the account still reads as Free until the webhook lands. The upgrade form came
// back a minute later (phase 'slow'), and pressing Continue again opened a second Checkout that
// could be paid for as well. The form stays away while the payment is unconfirmed, and the server
// refuses a second Checkout with `checkout_in_progress`.

const noop = () => {};
const CONSENT = { terms: true, immediate: true, cancellation: true };

describe('one payment at a time', () => {
  it.each(['confirming', 'slow'] as const)('offers no way to start another payment while the return is %s', (phase) => {
    render(<Billing account={cloudAccount()} busy={false} phase={phase} consentVersion="terms-2026-11" onCheckout={noop} onPortal={noop} />);
    expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^Premium/ })).toBeNull();
  });

  it('offers the plans again once a checkout was cancelled', () => {
    render(<Billing account={cloudAccount()} busy={false} phase="cancelled" consentVersion="terms-2026-11" onCheckout={noop} onPortal={noop} />);
    expect(screen.getByRole('button', { name: 'Continue with Standard' })).toBeInTheDocument();
  });

  it('says a refused second checkout in plain words, never the code', () => {
    const refused = new CloudError('checkout in progress', 409, 'checkout_in_progress');
    expect(checkoutProblem(refused)).toBe('Your payment is still being confirmed. This page updates by itself.');
  });

  it('tells the server when the last checkout was cancelled, and says nothing otherwise', () => {
    expect(checkoutBody('premium', 'month', CONSENT, 'v7', true)).toMatchObject({ after_cancel: true, plan: 'premium' });
    expect(checkoutBody('premium', 'month', CONSENT, 'v7')).not.toHaveProperty('after_cancel');
  });
});
