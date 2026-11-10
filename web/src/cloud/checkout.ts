import { useEffect, useRef, useState } from 'react';
import type { Account } from './api';

// Checkout, the parts that aren't drawing (docs/saas/08-billing.md §8.2 and §8.4).
//
// - The three UK consents are each their own tick box, and the request carries the consent
//   version the server published, so the server stores exactly what was agreed to.
// - Coming back from Stripe never says the plan changed until the server's entitlement snapshot
//   has: until then the page says "Confirming your payment…". Stripe's redirect alone proves
//   nothing; the webhook (or reconciliation) updating the snapshot does.

export type Consent = { terms: boolean; immediate: boolean; cancellation: boolean };
export type CheckoutPhase = 'idle' | 'confirming' | 'confirmed' | 'slow' | 'cancelled';

export const NO_CONSENT: Consent = { terms: false, immediate: false, cancellation: false };

export function consentComplete(consent: Consent) {
  return consent.terms && consent.immediate && consent.cancellation;
}

/** The consent version to send: the server's, else the one this build was made with. */
export function consentVersionFor(account: Account | null, built = import.meta.env.VITE_CHECKOUT_CONSENT_VERSION ?? '') {
  return account?.billing?.consent_version || built;
}

export function checkoutBody(plan: 'standard' | 'premium', interval: 'month' | 'year', consent: Consent, version: string) {
  return {
    plan,
    interval,
    consent_version: version,
    accepted_terms: consent.terms,
    requested_immediate_access: consent.immediate,
    acknowledged_cancellation_right: consent.cancellation,
  };
}

function returnedFromCheckout(): 'success' | 'cancelled' | null {
  const value = new URLSearchParams(window.location.search).get('checkout');
  return value === 'success' || value === 'cancelled' ? value : null;
}

/** Where a return from Stripe stands. While confirming it asks the server again every `everyMs`
 * (an `entitlement.changed` event makes it ask sooner), and gives up saying so after `tries`. */
export function useCheckoutReturn(account: Account | null, refresh: () => Promise<unknown>, { everyMs = 2000, tries = 30 } = {}): CheckoutPhase {
  const [phase, setPhase] = useState<CheckoutPhase>(() => {
    const returned = returnedFromCheckout();
    return returned === 'success' ? 'confirming' : returned === 'cancelled' ? 'cancelled' : 'idle';
  });
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (phase !== 'confirming' || !account) return;
    if (account.entitlement.plan !== 'free') {
      setPhase('confirmed');
      // Leave the address clean, so a reload doesn't start confirming again.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [phase, account]);

  useEffect(() => {
    if (phase !== 'confirming') return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > tries) {
        window.clearInterval(timer);
        setPhase('slow');
        return;
      }
      void latest.current().catch(() => {});
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [phase, everyMs, tries]);

  return phase;
}
