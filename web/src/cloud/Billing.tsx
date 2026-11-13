import { useId, useState } from 'react';
import { Account, featureOn, lockedTo, planName } from './api';
import { CheckoutPhase, Consent, consentComplete, NO_CONSENT } from './checkout';
import { Meters } from './Meters';

// Plan & billing (docs/saas/11-ui-ux.md §11.1): the current plan, the usage meters, and the way
// to change plan. A free account subscribes through Checkout, after the three UK consents; a paid
// one upgrades, downgrades or cancels in the Stripe portal, where proration and period-end
// downgrades are handled.

type Interval = 'month' | 'year';
type Paid = 'standard' | 'premium';

const PLANS: { id: Paid; name: string; storage: string; month: string; year: string; about: string; featured?: boolean }[] = [
  { id: 'standard', name: 'Standard', storage: '50 GB hosted audio (legacy)', month: '£6.99 / month', year: '£59 / year', about: 'Legacy hosted music storage and the benefits in your original subscription.' },
  { id: 'premium', name: 'Premium', storage: '100 GB hosted audio (legacy)', month: '£12.99 / month', year: '£109 / year', about: 'Legacy hosted audio processing and guest request rooms.', featured: true },
];

/** What a plan card says it includes, without naming a feature that's switched off for this
 * account (a plan-locked teaser still names it: that's what the plan unlocks). */
function aboutPlan(plan: (typeof PLANS)[number], account: Account) {
  const rooms = featureOn(account, 'rooms') || Boolean(lockedTo(account, 'rooms'));
  return plan.id === 'premium' && !rooms ? 'Priority processing.' : plan.about;
}

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

export function ConsentForm({ consent, onChange, version }: { consent: Consent; onChange: (next: Consent) => void; version: string }) {
  const id = useId();
  const tick = (key: keyof Consent) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...consent, [key]: event.target.checked });
  return (
    <fieldset className="cloud-legal" aria-describedby={`${id}-about`}>
      <legend><h2>Before subscribing</h2></legend>
      <p id={`${id}-about`}>UK law gives you 14 days to cancel a digital subscription. If you ask us to start now, you can use SelectaDJ Cloud straight away, and you may lose that right once the service has been fully provided. Tick each box to agree.</p>
      <label><input type="checkbox" checked={consent.terms} onChange={tick('terms')} /> I agree to the subscription terms.</label>
      <label><input type="checkbox" checked={consent.immediate} onChange={tick('immediate')} /> I ask for access to start immediately.</label>
      <label><input type="checkbox" checked={consent.cancellation} onChange={tick('cancellation')} /> I understand my 14-day cancellation right and when I may lose it.</label>
      {version
        ? <p className="cloud-consent-version">Consent wording version {version}</p>
        : <p className="cloud-inline-error">Checkout isn’t set up for this site yet.</p>}
    </fieldset>
  );
}

export function Billing({ account, busy, phase, consentVersion, onCheckout, onPortal, blocked }: {
  account: Account;
  busy: boolean;
  phase: CheckoutPhase;
  consentVersion: string;
  onCheckout: (plan: Paid, interval: Interval, consent: Consent) => void;
  onPortal: () => void;
  blocked?: boolean;
}) {
  const [interval, setInterval] = useState<Interval>('month');
  const [consent, setConsent] = useState<Consent>(NO_CONSENT);
  const paid = account.entitlement.plan !== 'free';
  const localFirst = account.entitlement.plan_version === 2;
  const newerContract = account.entitlement.plan_version > 2;
  // Each way to change plan is its own feature: with one off, it's gone from the page.
  const checkout = featureOn(account, 'billing.checkout');
  const portal = featureOn(account, 'billing.portal');
  const ready = consentComplete(consent) && Boolean(consentVersion) && !busy;
  const confirming = phase === 'confirming';
  return (
    <div className="cloud-billing">
      <CheckoutStatus phase={phase} account={account} />
      <section className="cloud-card cloud-current-plan">
        <div>
          <p className="cloud-eyebrow">CURRENT PLAN</p>
          <h2>{planName(account)}</h2>
          {account.lucy && featureOn(account, 'lucy') && <p>Includes {account.lucy.tier}.</p>}
          {localFirst
            ? <p>Your music, stems, renders and exports stay on your own device. Local disk space and device performance are not subscription quotas.</p>
            : <p>Your existing hosted-audio plan and purchased benefits remain in force until you explicitly approve a migration.</p>}
          {newerContract && <p role="status">This app may need an update to display your newer plan correctly. Your subscription remains unchanged.</p>}
        </div>
        {paid && portal && <button className="primary" disabled={busy} onClick={onPortal}>Change plan or cancel</button>}
      </section>
      <h2 className="cloud-section-title">{localFirst ? 'Hosted services usage' : 'This period’s legacy cloud usage'}</h2>
      <Meters account={account} />
      {paid
        ? portal && <section className="cloud-card"><p className="cloud-eyebrow">UPGRADE OR DOWNGRADE</p>
          {localFirst
            ? <p>Plan changes affect hosted services such as recipe sync, device management, Rooms and hosted Lucy—not your local music files or the hardware safety of an active speaker. Confirm timing, quantities and invoices in the secure Stripe portal.</p>
            : <p>Upgrades start now and are prorated. Downgrades take effect at the end of the period; your legacy hosted library is not deleted if it exceeds a lower plan, but uploads may be paused. Your authorised local files remain on your device. Payment details and invoices are in the secure Stripe portal.</p>}
        </section>
        : checkout && !confirming && !localFirst && !newerContract && <>
          <ConsentForm consent={consent} onChange={setConsent} version={consentVersion} />
          <div className="cloud-interval" role="group" aria-label="Billing interval">
            <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>Monthly</button>
            <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>Annual</button>
          </div>
          <div className="cloud-plan-grid">
            {PLANS.map((plan) => (
              <section key={plan.id} className={`cloud-plan-card ${plan.featured ? 'featured' : ''}`} aria-label={plan.name}>
                <p className="cloud-eyebrow">{plan.featured ? 'MOST ROOM TO PLAY' : 'FOR YOUR GROWING LIBRARY'}</p>
                <h2>{plan.name}</h2><strong>{plan.storage}</strong>
                <p className="cloud-price">{interval === 'month' ? plan.month : plan.year}</p>
                <p>{aboutPlan(plan, account)}</p>
                <button className={plan.featured ? 'primary' : ''} disabled={!ready} onClick={() => onCheckout(plan.id, interval, consent)}>Choose {plan.name}</button>
              </section>
            ))}
          </div>
          {!consentComplete(consent) && <p className="cloud-hint">Tick all three boxes above to choose a plan.</p>}
          {/* a slow checkout answer otherwise looks like nothing happened (2026-11-12 flow walk) */}
          {busy && consentComplete(consent) && <p className="cloud-hint" role="status">Opening secure checkout…</p>}
        </>}
      {localFirst && !paid && <section className="cloud-card">
        <p>Local-first paid plans cover recipe history, remote control, managed devices, collaboration, Rooms and hosted Lucy. Your device's music storage, local analysis, stems, renders and exports are not metered or sold by Selecta.</p>
        <p>New local-first prices are not displayed or charged until commercial terms and Stripe prices are approved.</p>
      </section>}
      {blocked && !localFirst && (paid ? portal : checkout) && <p className="cloud-hint">Upgrading a legacy hosted plan lifts the pause on eligible cloud uploads and exports when confirmed; it does not change device-local playback.</p>
    </div>
  );
}
