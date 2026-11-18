import { useId, useState } from 'react';
import { accountFlagOn, FlagId } from '../flags';
import { Account, lockedTo, planName } from './api';
import { CheckoutPhase, Consent, consentComplete, NO_CONSENT } from './checkout';
import { Meters } from './Meters';

// Plan & billing (docs/saas/11-ui-ux.md §11.1): the current plan, the usage meters, and the way
// to change plan. A free account subscribes through Checkout, after the three UK consents; a paid
// one upgrades, downgrades or cancels in the Stripe portal, where proration and period-end
// downgrades are handled.

type Interval = 'month' | 'year';
type Paid = 'standard' | 'premium';

const PLANS: { id: Paid; name: string; storage: string; month: string; year: string; about: string; featured?: boolean }[] = [
  { id: 'standard', name: 'Standard', storage: '50 GB', month: '£6.99 / month', year: '£59 / year', about: 'More room for your working library.' },
  { id: 'premium', name: 'Premium', storage: '100 GB', month: '£12.99 / month', year: '£109 / year', about: 'Priority processing and guest request rooms.', featured: true },
];

/** What each paid plan sells to a local-first account (ADR-0464, plan catalogue v2): Rooms, Lucy,
 * devices and discovery. Storage is not a plan line for these accounts, because their music stays
 * on their own devices; prices are the same as the hosted cards. `flag` hides an axis whose
 * feature is off for this account, and Rooms shows only where it is on or a plan-locked teaser. */
type Axis = { name: string; words: string; flag?: FlagId };
const LOCAL_FIRST_AXES: Record<Paid, { headline: string; eyebrow: string; axes: Axis[] }> = {
  standard: {
    headline: 'More from Lucy',
    eyebrow: 'For everyday mixing',
    axes: [
      { name: 'Lucy', words: 'Lucy Standard: 400 everyday turns and 40 planning turns a month.', flag: 'lucy' },
      { name: 'Discovery', words: 'Scheduled discovery sweeps for new links between your songs.' },
      { name: 'Devices', words: 'Sign in on up to 10 devices and play on one at a time.' },
    ],
  },
  premium: {
    headline: 'Rooms and Lucy Advanced',
    eyebrow: 'For hosting',
    axes: [
      { name: 'Rooms', words: 'Open a room for up to 100 guests, for up to 12 hours, with song requests.', flag: 'rooms' },
      { name: 'Lucy', words: 'Lucy Advanced: 150 everyday turns, 25 deep plans a month, and quick turns on fair use.', flag: 'lucy' },
      { name: 'Discovery', words: 'Larger scheduled discovery sweeps.' },
      { name: 'Devices', words: 'Sign in on up to 10 devices and play on one at a time.' },
    ],
  },
};

/** Whether this account's Cloud experience is local-first only, so storage is no part of its plan. */
export function sellsLocalFirst(account: Pick<Account, 'experience'>) {
  return account.experience?.local_first === true && account.experience?.hosted !== true;
}

function axisShown(axis: Axis, account: Account) {
  if (!axis.flag) return true;
  if (axis.flag === 'rooms') return accountFlagOn('rooms', account.features) || Boolean(lockedTo(account, 'rooms'));
  return accountFlagOn(axis.flag, account.features);
}

function LocalFirstPlan({ plan, account }: { plan: Paid; account: Account }) {
  const sells = LOCAL_FIRST_AXES[plan];
  const axes = sells.axes.filter((axis) => axisShown(axis, account));
  const rooms = axes.some((axis) => axis.name === 'Rooms');
  const lucy = axes.some((axis) => axis.name === 'Lucy');
  const headline = plan === 'premium'
    ? (rooms && lucy ? sells.headline : rooms ? 'Rooms' : lucy ? 'Lucy Advanced' : 'Bigger discovery')
    : (lucy ? sells.headline : 'Scheduled discovery');
  return (
    <>
      <strong>{headline}</strong>
      <ul className="cloud-plan-axes">
        {axes.map((axis) => <li key={axis.name}><b>{axis.name}</b> {axis.words}</li>)}
      </ul>
    </>
  );
}

/** What a plan card says it includes, without naming a feature that's switched off for this
 * account (a plan-locked teaser still names it: that's what the plan unlocks). */
function aboutPlan(plan: (typeof PLANS)[number], account: Account) {
  const rooms = accountFlagOn('rooms', account.features) || Boolean(lockedTo(account, 'rooms'));
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

export function Billing({ account, busy, phase, consentVersion, onCheckout, onPortal, blocked, localFirst }: {
  account: Account;
  /** Sell the local-first axes instead of storage. Read from the account's experience when left out. */
  localFirst?: boolean;
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
  // Each way to change plan is its own feature: with one off, it's gone from the page.
  const checkout = accountFlagOn('billing.checkout', account.features);
  const portal = accountFlagOn('billing.portal', account.features);
  const ready = consentComplete(consent) && Boolean(consentVersion) && !busy;
  const confirming = phase === 'confirming';
  const local = localFirst ?? sellsLocalFirst(account);
  return (
    <div className="cloud-billing">
      <CheckoutStatus phase={phase} account={account} />
      <section className="cloud-card cloud-current-plan">
        <div>
          <p className="cloud-eyebrow">Current plan</p>
          <h2>{planName(account)}</h2>
          {account.lucy && accountFlagOn('lucy', account.features) && <p>Includes {account.lucy.tier}.</p>}
        </div>
        {paid && portal && <button className="primary" disabled={busy} onClick={onPortal}>Change plan or cancel</button>}
      </section>
      <h2 className="cloud-section-title">This period’s usage</h2>
      <Meters account={account} />
      {paid
        ? portal && <section className="cloud-card"><p className="cloud-eyebrow">Upgrade or downgrade</p><p>{local
          ? 'Upgrades start now and are prorated. Downgrades take effect at the end of the period, and your music and mixes stay exactly as they are. Payment details and invoices are in the same secure Stripe portal.'
          : 'Upgrades start now and are prorated. Downgrades take effect at the end of the period; if your library is then bigger than the new plan, it stays playable and nothing is deleted. Payment details and invoices are in the same secure Stripe portal.'}</p></section>
        : checkout && !confirming && <>
          <ConsentForm consent={consent} onChange={setConsent} version={consentVersion} />
          <div className="cloud-interval" role="group" aria-label="Billing interval">
            <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>Monthly</button>
            <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>Annual</button>
          </div>
          <div className="cloud-plan-grid">
            {PLANS.map((plan) => (
              <section key={plan.id} className={`cloud-plan-card ${plan.featured ? 'featured' : ''}`} aria-label={plan.name}>
                <p className="cloud-eyebrow">{local ? LOCAL_FIRST_AXES[plan.id].eyebrow : plan.featured ? 'Most room to play' : 'For your growing library'}</p>
                <h2>{plan.name}</h2>
                {local
                  ? <><p className="cloud-price">{interval === 'month' ? plan.month : plan.year}</p><LocalFirstPlan plan={plan.id} account={account} /></>
                  : <><strong>{plan.storage}</strong>
                    <p className="cloud-price">{interval === 'month' ? plan.month : plan.year}</p>
                    <p>{aboutPlan(plan, account)}</p></>}
                <button className={plan.featured ? 'primary' : ''} disabled={!ready} onClick={() => onCheckout(plan.id, interval, consent)}>Choose {plan.name}</button>
              </section>
            ))}
          </div>
          {!consentComplete(consent) && <p className="cloud-hint">Tick all three boxes above to choose a plan.</p>}
          {/* a slow checkout answer otherwise looks like nothing happened (2026-11-12 flow walk) */}
          {busy && consentComplete(consent) && <p className="cloud-hint" role="status">Opening secure checkout…</p>}
        </>}
      {blocked && !local && (paid ? portal : checkout) && <p className="cloud-hint">Upgrading lifts the pause on uploads and exports as soon as your new plan is confirmed.</p>}
    </div>
  );
}
