import { useEffect, useRef, useState } from 'react';
import { CloudError, type Account } from './api';
import { refusalMessage } from './authConfig';
import { classify, plainMessage } from './resilientRequest';

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

/** `afterCancel`: the page came back from a Checkout the person cancelled, so the server lets a
 * new one start at once instead of refusing it as `checkout_in_progress`. */
export function checkoutBody(plan: 'standard' | 'premium', interval: 'month' | 'year', consent: Consent, version: string, afterCancel = false) {
  return {
    ...(afterCancel ? { after_cancel: true } : {}),
    plan,
    interval,
    consent_version: version,
    accepted_terms: consent.terms,
    requested_immediate_access: consent.immediate,
    acknowledged_cancellation_right: consent.cancellation,
  };
}

/** Whether this site can start a checkout at all. The server says so in the account's billing
 * block; an older server that does not say means it can, as before. */
export function checkoutAvailable(account: Account | null): boolean {
  return account?.billing?.checkout_available !== false;
}

export const UPGRADES_NOT_OPEN = 'Upgrades aren’t open yet on this site.';
const CHECKOUT_FAILED = 'SelectaDJ couldn’t start the payment. Nothing was charged. Try again in a moment.';

/** Why pressing Continue did not open Checkout, in plain words: the refusal's own sentence when
 * the server's code has one, never the code itself or a raw network error. */
export function checkoutProblem(problem: unknown): string {
  if (problem instanceof CloudError && problem.code) {
    if (problem.code === 'consent_version_changed') return 'The subscription terms have just been updated. Refresh the page to read the new wording, then try again.';
    return refusalMessage(problem.code) ?? CHECKOUT_FAILED;
  }
  const kind = classify(problem);
  return kind === 'refused' || kind === 'aborted' ? CHECKOUT_FAILED : plainMessage(problem);
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
    // 'slow' too: the page promised to show the new plan as soon as it's confirmed.
    if ((phase !== 'confirming' && phase !== 'slow') || !account) return;
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
