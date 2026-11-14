import { useId } from 'react';
import { Account, featureOn, planName } from './api';
import { CheckoutPhase, Consent } from './checkout';
import { Meters } from './Meters';

// Existing Stripe subscriptions and portals remain live for reconciliation.
// Checkout cannot advertise legacy Cloud music GB, media CPU or export quotas.
type Interval = 'month' | 'year';
type Paid = 'standard' | 'premium';

export function CheckoutStatus({ phase, account }: { phase: CheckoutPhase; account: Account }) {
  if (phase === 'idle') return null;
  const words = {
    confirming: 'Confirming your payment…',
    confirmed: `You’re on ${planName(account)}. Thanks for subscribing.`,
    slow: 'Your payment is still being confirmed. This page will show your new plan as soon as it is.',
    cancelled: 'Checkout was cancelled. Your plan hasn’t changed.',
  }[phase];
  return <div className={`cloud-feedback cloud-checkout-${phase}`} role="status" aria-busy={phase === 'confirming' || undefined}>{words}</div>;
}

// Retained as a compatible component for a later separately approved, version-2
// local-first checkout; never submit an obsolete v1 price from this page.
export function ConsentForm({ consent, onChange, version }: { consent: Consent; onChange: (next: Consent) => void; version: string }) {
  const id = useId();
  const tick = (key: keyof Consent) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...consent, [key]: event.target.checked });
  return (
    <fieldset className="cloud-legal" aria-describedby={`${id}-about`}>
      <legend><h2>Before subscribing</h2></legend>
      <p id={`${id}-about`}>UK consumer cancellation rights apply to digital subscriptions. Confirm the current terms, immediate access request and cancellation notice before paying.</p>
      <label><input type="checkbox" checked={consent.terms} onChange={tick('terms')} /> I agree to the subscription terms.</label>
      <label><input type="checkbox" checked={consent.immediate} onChange={tick('immediate')} /> I ask for access to start immediately.</label>
      <label><input type="checkbox" checked={consent.cancellation} onChange={tick('cancellation')} /> I understand my 14-day cancellation right and when I may lose it.</label>
      {version
        ? <p className="cloud-consent-version">Consent wording version {version}</p>
        : <p className="cloud-inline-error">Checkout isn’t set up for this site yet.</p>}
    </fieldset>
  );
}

export function Billing({ account, busy, phase, onPortal }: {
  account: Account;
  busy: boolean;
  phase: CheckoutPhase;
  consentVersion: string;
  onCheckout: (plan: Paid, interval: Interval, consent: Consent) => void;
  onPortal: () => void;
  blocked?: boolean;
}) {
  const paid = account.entitlement.plan !== 'free';
  const legacy = account.entitlement.plan_version !== 2;
  const portal = featureOn(account, 'billing.portal');
  return (
    <div className="cloud-billing">
      <CheckoutStatus phase={phase} account={account} />
      <section className="cloud-card cloud-current-plan">
        <div>
          <p className="cloud-eyebrow">CURRENT PLAN</p>
          <h2>{planName(account)}</h2>
          {account.lucy && featureOn(account, 'lucy') && <p>Includes {account.lucy.tier}.</p>}
          {legacy
            ? <p>Your historical plan and Stripe subscription details are retained for accurate billing and reconciliation. Cloud no longer hosts, streams or renders your music, regardless of your historical storage allowance.</p>
            : <p>Music, stems, rendering and exports stay on your own device. Your plan covers eligible connected services, not local disk space or processing time.</p>}
        </div>
        {paid && portal && <button className="primary" disabled={busy} onClick={onPortal}>Change plan or cancel</button>}
      </section>
      <h2 className="cloud-section-title">Local music and connected service usage</h2>
      <Meters account={account} />
      {paid
        ? portal && <section className="cloud-card">
            <p className="cloud-eyebrow">MANAGE SUBSCRIPTION</p>
            <p>Review invoices, cancellation and plan changes in the secure Stripe portal. Recipe history, devices, Rooms, collaboration, business capabilities and approved hosted AI may depend on your contracted benefits. Local media does not.</p>
          </section>
        : <section className="cloud-card">
            <p className="cloud-eyebrow">LOCAL-FIRST PAID PLANS</p>
            <p>New paid subscriptions are not offered until local-first prices, terms and Stripe mappings are approved. Existing subscriptions remain intact. Music on your device has no Cloud storage or local DSP quota.</p>
          </section>}
    </div>
  );
}
