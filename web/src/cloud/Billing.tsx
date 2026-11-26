import { CSSProperties, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { accountFlagOn, FlagId } from '../flags';
import { Account, bytes, holdsHostedStorage, lockedTo, planName } from './api';
import { Badge, Notice, SettingsCard } from './AccountLayout';
import { checkoutAvailable, CheckoutPhase, Consent, consentComplete, NO_CONSENT, UPGRADES_NOT_OPEN } from './checkout';
import { hasMeters, Meters } from './Meters';
import { useNeedsConnection } from './connection';
import { Icon } from '../ui/Icon';
import { countOf } from '../ui/format';
import { BillingStandingNotice } from './BillingStanding';
import { ICON_SLOTS, ICON_STROKES } from '../ui/Icon';
import { feelOn, onFeelChange } from '../feel/root';
import { INDICATOR_CLASS, useSlidingIndicator } from '../feel/indicator';
import { NumberRoll } from '../feel/numberRoll';
import { Moment } from '../feel/moment';

// Plan & billing (docs/saas/11-ui-ux.md §11.1): the current plan, the usage meters, and the way
// to change plan, each in its own titled card. A free account picks a plan, ticks the three UK
// consents and continues to Checkout with one button; a paid one upgrades, downgrades or cancels
// in the Stripe portal, where proration and period-end downgrades are handled.

type Interval = 'month' | 'year';
type Paid = 'standard' | 'premium';
/** What the plan picker starts on: the cheaper plan, billed monthly. */
export const DEFAULT_PLAN: Paid = 'standard';
export const DEFAULT_INTERVAL: Interval = 'month';

const PLANS: { id: Paid; name: string; storage: string; month: string; year: string; about: string; featured?: boolean }[] = [
  { id: 'standard', name: 'Standard', storage: '50 GB', month: '£6.99 / month', year: '£59 / year', about: 'More room for your working library.' },
  { id: 'premium', name: 'Premium', storage: '100 GB', month: '£12.99 / month', year: '£109 / year', about: 'Priority processing and guest request rooms.', featured: true },
];

/** What each paid plan sells to a local-first account (ADR-0464, plan catalogue v2): Rooms, Lucy,
 * devices and discovery. Storage is not a plan line for these accounts, because their music stays
 * on their own devices; prices are the same as the hosted cards. `flag` hides an axis whose
 * feature is off for this account, and Rooms shows only where it is on or a plan-locked teaser. */
type Axis = { name: string; words: string; flag?: FlagId };
/* Each line is drawn as its bold name then its words, so the words never start with the name
   again: "Lucy" then "Standard: ...", which reads "Lucy Standard: ..." once. */
const LOCAL_FIRST_AXES: Record<Paid, { headline: string; eyebrow: string; axes: Axis[] }> = {
  standard: {
    headline: 'More from Lucy',
    eyebrow: 'For everyday mixing',
    axes: [
      { name: 'Lucy', words: 'Standard: 400 everyday turns and 40 planning turns a month, usually answered by Claude Sonnet (a very heavy month moves to a lighter model).', flag: 'lucy' },
      { name: 'Discovery', words: 'Scheduled discovery sweeps for new links between your songs.' },
      { name: 'Devices', words: 'Sign in on up to 10 devices and play on one at a time.' },
    ],
  },
  premium: {
    headline: 'Rooms and Lucy Advanced',
    eyebrow: 'For hosting',
    axes: [
      { name: 'Rooms', words: 'Open a room for up to 100 guests, for up to 12 hours, with song requests.', flag: 'rooms' },
      { name: 'Lucy', words: 'Advanced: 150 everyday turns, 25 deep plans a month, and quick turns on fair use, usually answered by Claude Opus (a very heavy month moves to a lighter model).', flag: 'lucy' },
      { name: 'Discovery', words: 'Larger scheduled discovery sweeps.' },
      { name: 'Devices', words: 'Sign in on up to 10 devices and play on one at a time.' },
    ],
  },
};

/** Lucy on each plan in level words only (ADR-0484 rule 4, ADR-0483 rule 9): no counts and no
 * names of what answers. Used once the server sends the usage read model; until then the cards
 * keep the words above. Each is drawn after the bold "Lucy", as the axes are. */
export const LUCY_LEVEL_WORDS: Record<'free' | Paid, string> = {
  free: 'Basic: a small share of Lucy each week. Once a session’s share is used, a simpler built-in planner answers until the session ends.',
  standard: 'Standard: more of Lucy each week than Free, with a lighter Lucy for the rest of a session once its share is used.',
  premium: 'Advanced: the most of Lucy each week, with a lighter Lucy for the rest of a session once its share is used.',
};

/** Whether the server sent the usage read model, so the cards describe Lucy by level. */
const lucyByLevel = (account: Account) => Boolean(account.usage?.lucy_windows);

/** Whether this account's Cloud experience is local-first only, so storage is no part of its plan. */
export function sellsLocalFirst(account: Pick<Account, 'experience'>) {
  return account.experience?.local_first === true && account.experience?.hosted !== true;
}

function axisShown(axis: Axis, account: Account) {
  if (!axis.flag) return true;
  if (axis.flag === 'rooms') return accountFlagOn('rooms', account.features) || Boolean(lockedTo(account, 'rooms'));
  return accountFlagOn(axis.flag, account.features);
}

function shownAxes(plan: Paid, account: Account) {
  const axes = LOCAL_FIRST_AXES[plan].axes.filter((axis) => axisShown(axis, account));
  return lucyByLevel(account) ? axes.map((axis) => (axis.name === 'Lucy' ? { ...axis, words: LUCY_LEVEL_WORDS[plan] } : axis)) : axes;
}

/** Whether the feel's motion is on, read live so turning it off mid-page puts the plain marks back. */
function useFeelMotion() {
  return useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
}

/** The check mark drawn as a stroke that draws itself (.feel-tick), the same size and weight as the
 * Icon it stands in for. Only used while the feel's motion is on, so with it off the page keeps the
 * plain Icon exactly as before. */
function DrawnCheck() {
  const box = ICON_SLOTS.compact;
  return (
    <svg className="ui-icon" data-icon="check" data-size="compact" viewBox="0 0 24 24" width={box} height={box} fill="none" stroke="currentColor" strokeWidth={ICON_STROKES.compact} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path className="feel-tick" pathLength={1} d="m5 12 4 4L19 6" />
    </svg>
  );
}

function AxisList({ axes, cols, draw }: { axes: Axis[]; cols?: boolean; draw?: boolean }) {
  const moving = useFeelMotion();
  // On the current plan the lines arrive one after another and their ticks draw, so what the plan
  // includes reads as a list being checked off; elsewhere the list is as it always was.
  const drawn = draw && moving;
  return (
    <ul className="acct-includes cloud-plan-axes" data-cols={cols && axes.length > 1 ? '2' : undefined} data-stagger={drawn || undefined}>
      {axes.map((axis, index) => (
        <li key={axis.name} style={drawn ? ({ '--i': index } as CSSProperties) : undefined}>
          {drawn ? <DrawnCheck /> : <Icon name="check" size="compact" />}<span><b>{axis.name}</b> {axis.words}</span>
        </li>
      ))}
    </ul>
  );
}

/** A local-first plan's one-line headline, naming only what this account can see. */
function localHeadline(plan: Paid, account: Account) {
  const sells = LOCAL_FIRST_AXES[plan];
  const axes = shownAxes(plan, account);
  const rooms = axes.some((axis) => axis.name === 'Rooms');
  const lucy = axes.some((axis) => axis.name === 'Lucy');
  return plan === 'premium'
    ? (rooms && lucy ? sells.headline : rooms ? 'Rooms' : lucy ? 'Lucy Advanced' : 'Bigger discovery')
    : (lucy ? sells.headline : 'Scheduled discovery');
}

function LocalFirstPlan({ plan, account }: { plan: Paid; account: Account }) {
  return (
    <>
      <strong className="cloud-plan-headline">{localHeadline(plan, account)}</strong>
      <AxisList axes={shownAxes(plan, account)} />
    </>
  );
}

/** What a plan card says it includes, without naming a feature that's switched off for this
 * account (a plan-locked teaser still names it: that's what the plan unlocks). */
function aboutPlan(plan: (typeof PLANS)[number], account: Account) {
  const rooms = accountFlagOn('rooms', account.features) || Boolean(lockedTo(account, 'rooms'));
  return plan.id === 'premium' && !rooms ? 'Priority processing.' : plan.about;
}

/** What the plan this account is on includes, in plain words. Only things the account can
 * actually see: storage for an account that holds any, Lucy where Lucy is on. */
function currentIncludes(account: Account, local: boolean): Axis[] {
  const plan = account.entitlement.plan;
  if (local && (plan === 'standard' || plan === 'premium')) return shownAxes(plan, account);
  const lines: Axis[] = [];
  if (holdsHostedStorage(account)) lines.push({ name: 'Storage', words: `${bytes(account.usage?.storage.limit_bytes ?? account.entitlement.storage_limit_bytes)} for your music.` });
  const level = lucyByLevel(account) ? (LUCY_LEVEL_WORDS as Record<string, string | undefined>)[plan] : undefined;
  if (account.lucy && accountFlagOn('lucy', account.features)) lines.push({ name: 'Lucy', words: level ?? `${account.lucy.tier.replace(/^Lucy\s+/, '')}.` });
  const sold = PLANS.find((item) => item.id === plan);
  if (sold && !local) lines.push({ name: 'Extras', words: aboutPlan(sold, account) });
  return lines;
}

/** Whether the library is past the plan's soft cap, a sanity bound (never a refusal). */
export function overSoftCap(account: Account): boolean {
  const library = account.usage?.library;
  return !!library && library.soft_cap > 0 && library.songs > library.soft_cap;
}

/** A price as its figure and its period ("£6.99" and "/ month"), so the figure can be read at a glance. */
function Price({ words }: { words: string }) {
  const [figure, period] = words.split(' / ');
  // the figure rolls to the new price when Monthly and Annual are swapped; it is the same words
  const amount = amountOf(figure);
  return <p className="cloud-price">{amount ? <NumberRoll value={amount.amount} format={() => figure} /> : figure}{period && <small> / {period}</small>}</p>;
}

/** The amount in a price ("£59 / year" is 59) with what is written before it ("£"), or null. */
function amountOf(words: string): { before: string; amount: number } | null {
  const found = words.match(/^([^\d]*)(\d+(?:\.\d+)?)/);
  if (!found) return null;
  const amount = Number(found[2]);
  return Number.isFinite(amount) && amount > 0 ? { before: found[1], amount } : null;
}

/** What paying yearly comes to against paying monthly, worked out from the two prices on the
 * card: "£4.92 a month, billed yearly. Save £24.88." The saving is only said when there is one,
 * and nothing at all when either price cannot be read. */
export function yearlyComparison(month: string, year: string): string | null {
  const monthly = amountOf(month);
  const yearly = amountOf(year);
  if (!monthly || !yearly || monthly.before !== yearly.before) return null;
  const money = (amount: number) => `${yearly.before}${amount.toFixed(2)}`;
  const saved = Math.round((monthly.amount * 12 - yearly.amount) * 100) / 100;
  return `${money(yearly.amount / 12)} a month, billed yearly.${saved > 0 ? ` Save ${money(saved)}.` : ''}`;
}

/** The chosen plan, opened out into what Continue will start: the plan, its price and how it is
 * billed. Only with the feel's motion on, where it grows out of the chosen card each time another
 * plan is picked (feel-account.css); the line beside Continue says the same in words either way,
 * and nothing here waits on the animation. */
function CheckoutSummary({ plan, price, interval, headline }: { plan: (typeof PLANS)[number]; price: string; interval: Interval; headline: string }) {
  return (
    <div className="cloud-checkout-summary" data-from={plan.id === 'standard' ? 'start' : 'end'}>
      <p className="cloud-checkout-summary-kind">You are choosing</p>
      <p className="cloud-checkout-summary-plan"><b>{plan.name}</b> <span>{headline}</span></p>
      <Price words={price} />
      <p className="cloud-checkout-summary-note">{interval === 'month' ? 'Billed monthly' : 'Billed yearly'}. Payment is taken by Stripe on the next page, and you can change or cancel at any time.</p>
    </div>
  );
}

export function CheckoutStatus({ phase, account }: { phase: CheckoutPhase; account: Account }) {
  if (phase === 'idle') return null;
  const words = {
    confirming: 'Confirming your payment…',
    confirmed: `You’re on ${planName(account)}. Thanks for subscribing.`,
    slow: 'Your payment is still being confirmed. This page will show your new plan as soon as it is.',
    cancelled: 'Checkout was cancelled. Your plan hasn’t changed.',
  }[phase];
  const tone = ({ confirming: 'info', confirmed: 'ok', slow: 'warn', cancelled: 'info' } as const)[phase];
  return (
    <div className={`cloud-checkout-status cloud-checkout-${phase}`} aria-busy={phase === 'confirming' || undefined}>
      <Notice tone={tone} icon={phase === 'confirming' ? 'clock' : undefined}>{words}</Notice>
    </div>
  );
}

export function ConsentForm({ consent, onChange, version }: { consent: Consent; onChange: (next: Consent) => void; version: string }) {
  const id = useId();
  const tick = (key: keyof Consent) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...consent, [key]: event.target.checked });
  return (
    <fieldset className="cloud-legal" aria-describedby={`${id}-about`}>
      <legend><h3>Before subscribing</h3></legend>
      <p id={`${id}-about`}>UK law gives you 14 days to cancel a digital subscription. If you ask us to start now, you can use SelectaDJ Cloud straight away, and you may lose that right once the service has been fully provided. Tick each box to agree.</p>
      <label><input type="checkbox" checked={consent.terms} onChange={tick('terms')} /> I agree to the subscription terms.</label>
      <label><input type="checkbox" checked={consent.immediate} onChange={tick('immediate')} /> I ask for access to start immediately.</label>
      <label><input type="checkbox" checked={consent.cancellation} onChange={tick('cancellation')} /> I understand my 14-day cancellation right and when I may lose it.</label>
      {version
        ? <p className="cloud-consent-version">Consent wording version {version}</p>
        : <p className="cloud-inline-error">Checkout isn’t set up for this site.</p>}
    </fieldset>
  );
}

export function Billing({ account, busy, phase, consentVersion, onCheckout, onPortal, blocked, localFirst, error }: {
  account: Account;
  /** Why the last press of Continue did not open Checkout, in plain words; shown beside the button. */
  error?: string;
  /** Sell the local-first axes instead of storage. Read from the account's experience when left out. */
  localFirst?: boolean;
  busy: boolean;
  phase: CheckoutPhase;
  consentVersion: string;
  onCheckout: (plan: Paid, interval: Interval, consent: Consent) => void;
  onPortal: () => void;
  blocked?: boolean;
}) {
  const [interval, setInterval] = useState<Interval>(DEFAULT_INTERVAL);
  const [consent, setConsent] = useState<Consent>(NO_CONSENT);
  // Defaults (docs/saas/11-ui-ux.md): the cheaper plan and Monthly start chosen, so continuing
  // without looking never costs more than meant; the button and hint name the plan and price.
  const [chosen, setChosen] = useState<Paid>(DEFAULT_PLAN);
  // which of the two portal buttons was pressed, so only that one says it is opening
  const [pressed, setPressed] = useState<'change' | 'invoices' | null>(null);
  const paid = account.entitlement.plan !== 'free';
  // Each way to change plan is its own feature: with one off, it's gone from the page.
  const checkout = accountFlagOn('billing.checkout', account.features);
  const portal = accountFlagOn('billing.portal', account.features);
  // cloud.offline_shell: checkout and the billing portal open on the server
  const offline = useNeedsConnection();
  const ready = consentComplete(consent) && Boolean(consentVersion) && !busy && !offline;
  // back from Stripe and not confirmed yet ('slow' is the same wait, a minute on): the payment may
  // already be made, so the way to start another one is not offered
  const confirming = phase === 'confirming' || phase === 'slow';
  // the server says when this site cannot start a payment at all (no Stripe key or prices)
  const open = checkoutAvailable(account);
  const local = localFirst ?? sellsLocalFirst(account);
  const includes = currentIncludes(account, local);
  const choice = PLANS.find((plan) => plan.id === chosen)!;
  const price = (plan: (typeof PLANS)[number]) => (interval === 'month' ? plan.month : plan.year);
  const openPortal = (from: 'change' | 'invoices') => { setPressed(from); onPortal(); };
  const intervalStrip = useRef<HTMLDivElement>(null);
  useSlidingIndicator(intervalStrip, '[aria-pressed="true"]');
  const upgraded = useUpgradeMoment(phase);
  const moving = useFeelMotion();
  const opening = (from: 'change' | 'invoices') => busy && pressed === from;
  return (
    <div className="cloud-billing" data-stagger="auto">
      <CheckoutStatus phase={phase} account={account} />
      <BillingStandingNotice account={account} place="billing" busy={opening('change')} onPortal={() => openPortal('change')} />
      <SettingsCard
        id="cloud-plan"
        className="acct-plan-current"
        title="Your plan"
        about="What you are on now, and what it includes."
        actions={paid && portal && <button type="button" className="primary" disabled={!!offline} aria-disabled={busy || undefined} aria-busy={opening('change') || undefined} onClick={() => { if (!busy) openPortal('change'); }}>{opening('change') ? 'Opening…' : 'Change plan'}</button>}
      >
        <div className="acct-card-titles"><p className="acct-plan-name">{planName(account)}</p><Badge tone="accent">Current plan</Badge></div>
        {/* keyed by the upgrade, so the lines arrive and tick again when the new plan is confirmed */}
        {includes.length > 0 && <AxisList key={upgraded.round} axes={includes} cols draw />}
        {upgraded.playing && <Moment kind="equalizer" onDone={upgraded.done} />}
        {paid
          ? portal && <p className="acct-plan-foot">{local
            ? 'Upgrades start straight away and are prorated. Downgrades start at the end of the period, and your music and mixes stay exactly as they are.'
            : 'Upgrades start straight away and are prorated. Downgrades start at the end of the period; a library bigger than the new plan stays playable and nothing is deleted. Finished exports are kept for the new plan’s time, counted from the day it starts.'}</p>
          : checkout && open && <p className="acct-plan-foot">Upgrade whenever you like. You can change or cancel at any time.</p>}
        {overSoftCap(account) && <p className="acct-plan-foot" data-testid="library-soft-cap">{`Your library holds ${countOf(account.usage!.library!.songs, 'song')}, more than the ${countOf(account.usage!.library!.soft_cap, 'song')} ${planName(account)} is made for. Everything still plays and nothing is removed; a very large library can make some pages slower.`}</p>}
        {offline && <p className="needs-connection">{offline}</p>}
      </SettingsCard>
      {hasMeters(account) && (
        <SettingsCard id="cloud-usage" title="Usage" about="What you have used so far, and when each allowance starts again.">
          <Meters account={account} />
        </SettingsCard>
      )}
      {paid && portal && (
        <SettingsCard
          id="cloud-payments"
          className="cloud-plan-note"
          title="Payment and invoices"
          about="Your card, receipts and invoices are kept in the secure Stripe billing portal. Cancelling is there too."
          actions={<button type="button" disabled={!!offline} aria-disabled={busy || undefined} aria-busy={opening('invoices') || undefined} onClick={() => { if (!busy) openPortal('invoices'); }}>{opening('invoices') ? 'Opening…' : 'Open billing portal'}</button>}
        />
      )}
      {!paid && checkout && !confirming && (
        <SettingsCard
          id="cloud-upgrade"
          title="Upgrade your plan"
          about={open ? 'Pick a plan, then continue to secure checkout.' : 'What each plan adds.'}
          actions={(
            <div className="cloud-interval" role="group" aria-label="Billing interval" ref={intervalStrip} data-indicator-shape="fill">
              {/* first, so the moving fill is painted under the two words, not over them */}
              <span className={INDICATOR_CLASS} aria-hidden="true" />
              <button type="button" aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>Monthly</button>
              <button type="button" aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>Annual</button>
            </div>
          )}
        >
          {/* a site that cannot start a payment shows the plans to read, with nothing to choose */}
          <div className="cloud-plan-grid" role={open ? 'radiogroup' : 'group'} aria-label={open ? 'Plan' : 'Plans'} data-info={!open || undefined}>
            {PLANS.map((plan) => (
              <label key={plan.id} className={`cloud-plan-card ${plan.featured ? 'featured' : ''}`} data-chosen={(open && chosen === plan.id) || undefined} data-lift="" data-glow="">
                <span className="cloud-plan-pick">
                  {open && <input type="radio" name="cloud-plan" value={plan.id} checked={chosen === plan.id} onChange={() => setChosen(plan.id)} />}
                  <span className="cloud-plan-title">{plan.name}</span>
                  <span className="cloud-plan-kind">{local ? LOCAL_FIRST_AXES[plan.id].eyebrow : plan.featured ? 'Most room to play' : 'For your growing library'}</span>
                </span>
                <Price words={price(plan)} />
                {interval === 'year' && yearlyComparison(plan.month, plan.year) && <p className="cloud-price-note">{yearlyComparison(plan.month, plan.year)}</p>}
                {local
                  ? <LocalFirstPlan plan={plan.id} account={account} />
                  : <><strong className="cloud-plan-headline">{plan.storage}</strong><p>{aboutPlan(plan, account)}</p></>}
              </label>
            ))}
          </div>
          {open ? (
            <>
              {moving && <CheckoutSummary key={chosen} plan={choice} price={price(choice)} interval={interval} headline={local ? localHeadline(choice.id, account) : choice.storage} />}
              <ConsentForm consent={consent} onChange={setConsent} version={consentVersion} />
              <div className="acct-plans-head">
                {/* why the last press did not open Checkout is said here, beside the button */}
                {error && !busy
                  ? <p className="cloud-hint cloud-inline-error" role="alert">{error}</p>
                  : <p className="cloud-hint" role="status">{busy && consentComplete(consent) ? 'Opening secure checkout…' : consentComplete(consent) ? `${choice.name}, ${price(choice)}. Payment is taken by Stripe.` : 'Tick all three boxes to continue.'}</p>}
                <button type="button" className="primary" disabled={!ready} aria-busy={(busy && consentComplete(consent)) || undefined} onClick={() => onCheckout(chosen, interval, consent)}>{busy && consentComplete(consent) ? 'Opening checkout…' : `Continue with ${choice.name}`}</button>
              </div>
              {offline && <p className="needs-connection">{offline}</p>}
            </>
          ) : <p className="cloud-hint" data-testid="upgrades-not-open">{UPGRADES_NOT_OPEN}</p>}
        </SettingsCard>
      )}
      {blocked && !local && (paid ? portal : checkout) && <p className="cloud-hint">Upgrading lifts the pause on uploads and exports as soon as your new plan is confirmed.</p>}
    </div>
  );
}

// The upgrade moment plays once per page load, so coming back to Plan & billing later is calm.
let upgradeCelebrated = false;

/** The upgrade moment (ADR-0477): when the return from Stripe really reports the plan confirmed
 * (useCheckoutReturn only says 'confirmed' after the server's entitlement changed), the current plan
 * card gets one equalizer burst and its lines arrive and tick again. Nothing plays while the
 * payment is still being confirmed or when it was cancelled. No buzz: the return from Stripe is a
 * redirect, not a press, so a phone refuses to vibrate here (feel/haptics.ts), and saving one for
 * a later press would buzz for something else. */
function useUpgradeMoment(phase: CheckoutPhase) {
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (phase !== 'confirmed' || upgradeCelebrated) return;
    upgradeCelebrated = true;
    setRound((value) => value + 1);
    setPlaying(true);
  }, [phase]);
  return { round, playing, done: () => setPlaying(false) };
}
