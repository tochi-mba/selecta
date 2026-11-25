import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { feelOff } from '../test/feel';
import { Billing } from './Billing';

/** Plan 3.12: with the feel's motion on, the chosen plan opens out into what Continue will start,
 * and grows again from the side of the newly chosen card. It is never in the way of paying: the
 * consents and Continue are exactly as with the feel off. */

const noop = () => {};
const summary = () => document.querySelector('.cloud-checkout-summary');

describe('the chosen plan as the checkout summary', () => {
  it('names the chosen plan, its price and how it is billed, and follows the choice', async () => {
    render(<Billing account={cloudAccount()} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(summary()).toHaveTextContent('Standard');
    expect(summary()).toHaveTextContent('£6.99');
    expect(summary()).toHaveTextContent('Billed monthly');
    expect(summary()).toHaveAttribute('data-from', 'start');
    await userEvent.click(screen.getByRole('radio', { name: /^Premium/ }));
    expect(summary()).toHaveTextContent('Premium');
    expect(summary()).toHaveAttribute('data-from', 'end');
    await userEvent.click(screen.getByRole('button', { name: 'Annual' }));
    expect(summary()).toHaveTextContent('Billed yearly');
    // Continue is there and waits only on the consents, never on the summary
    expect(screen.getByRole('button', { name: 'Continue with Premium' })).toBeDisabled();
  });

  it('is not drawn with the feel off', () => {
    feelOff();
    const { unmount } = render(<Billing account={cloudAccount()} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(summary()).toBeNull();
    unmount();
  });

  it('is not drawn when the site cannot start a payment', () => {
    render(<Billing account={{ ...cloudAccount(), billing: { consent_version: 'v1', checkout_available: false } }} busy={false} phase="idle" consentVersion="v1" onCheckout={noop} onPortal={noop} />);
    expect(summary()).toBeNull();
  });
});
