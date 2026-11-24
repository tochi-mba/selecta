import { useState } from 'react';
import { accountFlagOn } from '../flags';
import { supportHref } from '../support';
import { dateWords } from '../ui/format';
import type { Account, BillingStanding } from './api';
import { Notice } from './AccountLayout';

// A failed renewal, a cancellation, a payment the bank wants confirmed and the drop to Free, said
// calmly in the app shell and on Billing (docs/engineering/paying-customer-audit.md, gap 1). The
// server decides the moment (billing/standing.py); this only words it. Dismissing hides that one
// event in this browser for good; a new event (a new state or date) has a new key and shows again.

export const STANDING_FLAG = 'billing.standing';
const DISMISSED = 'selecta.billing.dismissed';

function dismissedKeys(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(DISMISSED) ?? '[]');
    return Array.isArray(kept) ? kept.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function dismiss(key: string) {
  try {
    localStorage.setItem(DISMISSED, JSON.stringify([...dismissedKeys().filter((kept) => kept !== key), key].slice(-20)));
  } catch {
    // storage refused (private browsing, full): it stays hidden for this visit only
  }
}

/** The words for one billing moment, with the date in the reader's own time zone. */
export function standingWords(standing: BillingStanding, timeZone?: string): { text: string; tone: 'warn' | 'info'; action: string | null } {
  const plan = standing.plan_label;
  const date = standing.at ? dateWords(standing.at, { timeZone }) : null;
  switch (standing.state) {
    case 'payment_failed':
      return { tone: 'warn', action: 'Update card', text: date
        ? `We couldn’t take your last payment. Your ${plan} plan stays until ${date}. Update your card to keep it.`
        : `We couldn’t take your last payment. Update your card to keep your ${plan} plan.` };
    case 'action_required':
      return { tone: 'warn', action: 'Confirm payment', text: date
        ? `Your bank wants you to confirm your last payment. Your ${plan} plan stays until ${date}. Confirm it to keep the plan.`
        : `Your bank wants you to confirm your payment for ${plan}. Your plan starts once it is confirmed.` };
    case 'cancelling':
      return { tone: 'info', action: 'Keep my plan', text: date
        ? `Your ${plan} plan ends on ${date}. After that you’re on Free.`
        : `Your ${plan} plan is cancelled. After it ends you’re on Free.` };
    case 'ended_payment_failed':
      return { tone: 'info', action: null, text: date
        ? `Your ${plan} plan ended on ${date} because payment failed. Your music and mixes are still here.`
        : `Your ${plan} plan ended because payment failed. Your music and mixes are still here.` };
  }
}

/** The notice, or nothing: with `billing.standing` off, with no moment, or once dismissed. */
export function BillingStandingNotice({ account, onPortal, busy, place }: {
  account: Account;
  onPortal: () => void;
  busy?: boolean;
  /** `shell` is the banner slot above every page; `billing` is the top of Plan & billing. */
  place: 'shell' | 'billing';
}) {
  const standing = account.billing?.standing ?? null;
  const [hidden, setHidden] = useState(() => dismissedKeys());
  if (!standing || !accountFlagOn(STANDING_FLAG, account.features) || hidden.includes(standing.key)) return null;
  const words = standingWords(standing);
  const manager = standing.can_manage !== false;
  const portal = accountFlagOn('billing.portal', account.features);
  const fix = words.action && manager && portal && (
    <button type="button" className={place === 'billing' ? 'primary' : undefined} aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={() => { if (!busy) onPortal(); }}>
      {busy ? 'Opening…' : words.action}
    </button>
  );
  const close = () => { dismiss(standing.key); setHidden(dismissedKeys().concat(standing.key)); };
  return (
    <div className="cloud-billing-standing" data-state={standing.state} data-place={place}>
      <Notice tone={words.tone} role={words.tone === 'warn' ? 'alert' : 'status'} action={(
        <span className="cloud-billing-standing-actions">
          {fix}
          {words.tone === 'warn' && <a className="button quiet" href={supportHref('A billing question', undefined)}>Contact support</a>}
          <button type="button" className="quiet" onClick={close}>Dismiss</button>
        </span>
      )}>
        <p>{words.text}</p>
        {words.action && !manager && <p className="hint">The workspace owner can update the payment details.</p>}
      </Notice>
    </div>
  );
}
