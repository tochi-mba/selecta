import { useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, when } from './adminApi';
import { Failure, Panel, useLoad } from './parts';
import { ActionButton, DangerRequest, REASONS, useConsole, write } from './safety';
import { words } from './ui';

// Lucy's session and week allowance in the staff console (ADR-0485 rule 7, ADR-0487 rules 6 and
// 7): one account's factor, Lucy off and back, the switch-over now or cancelled, and the shadow
// measurement report. Every change goes through the danger dialog: a reason, the email typed,
// the server's refusal shown in the dialog, and one request per press.

/** The server's range for a factor, in thousandths: 0 to 100 times the plan's allowance. */
export const MAX_FACTOR_MILLI = 100_000;
const NEEDS = 'billing.overrides.create';

/** "1.5" becomes 1500 thousandths. Null unless it is a number from 0 to 100 with at most three
 * decimal places, which is what the server accepts. */
export function factorMilli(text: string): number | null {
  const typed = text.trim();
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(typed)) return null;
  const milli = Math.round(Number(typed) * 1000);
  return milli <= MAX_FACTOR_MILLI ? milli : null;
}

type Step = Pick<DangerRequest, 'title' | 'button' | 'consequences' | 'reasons'>;

/** The Lucy allowance actions for one account's workspace. The admin API does not send the
 * current factor or switch state yet, so this shows what was done here and points at the log. */
export function LucyAllowance({ workspaceId, email }: { workspaceId: string | null; email: string }) {
  const ctx = useConsole();
  const [factor, setFactor] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [last, setLast] = useState('');
  if (!workspaceId) {
    return <section className="admin-config" aria-label="Lucy allowance"><h3>Lucy allowance</h3><p className="admin-note">No workspace yet.</p></section>;
  }
  const base = `/admin/ai/workspaces/${encodeURIComponent(workspaceId)}`;
  const finish = (text: string) => { setLast(text); ctx.toast({ text, tone: 'ok' }); };
  const ask = (step: Step, run: (reason: string) => Promise<string>) => ctx.ask({
    action: 'lucy.allowance', ...step, confirmText: email, confirmLabel: `Type ${email} to confirm`, irreversible: false, done: 'Done.',
    run: async (reason) => { finish(await run(reason)); },
  });
  const multiplier = (milli: number | null, step: Step, done: string) => ask(step, async (reason) => {
    await write(ctx.api, { path: `${base}/multiplier`, method: 'PUT', body: { multiplier_milli: milli, reason } });
    return done;
  });
  const off = () => multiplier(0, {
    title: `Switch Lucy off for ${email}`, button: `Switch Lucy off for ${email}`, reasons: REASONS.abuse,
    consequences: ['Lucy’s AI stops for this account at once.', 'What the account has used is kept.', 'Back to the plan’s allowance undoes it.'],
  }, `Lucy is off for ${email}.`);
  const plan = () => multiplier(null, {
    title: `Put ${email} back on the plan’s allowance`, button: 'Back to the plan’s allowance', reasons: REASONS.support,
    consequences: ['Any factor set by staff is removed, so Lucy is on again if staff switched it off.', 'The account gets its plan’s own session and week limits.', 'What the account has used is kept.'],
  }, `${email} is back on the plan’s own Lucy allowance.`);
  const setTo = () => {
    const milli = factorMilli(factor);
    setInvalid(milli === null);
    if (milli === null) return;
    if (milli === 0) { off(); return; }
    const times = `${milli / 1000} times`;
    multiplier(milli, {
      title: `Set ${email}’s Lucy factor to ${milli / 1000}`, button: `Set the factor to ${milli / 1000}`, reasons: REASONS.billing,
      consequences: [`This account’s Lucy allowance becomes ${times} its plan’s allowance, at once.`, 'What the account has used is kept.', 'Back to the plan’s allowance undoes it.'],
    }, `${email}’s Lucy allowance is now ${times} the plan’s.`);
  };
  const cutover = (now: boolean) => ask(now ? {
    title: `Switch ${email} to the session and week allowance now`, button: 'Switch over now', reasons: ['Testing the new allowance', ...REASONS.support],
    consequences: ['This account moves from turns to the session and week allowance now.', 'Its first week opens with nothing used.', 'It only applies while the account has the lucy.usage_windows flag.', 'Cancel the switch undoes it.'],
  } : {
    title: `Cancel ${email}’s switch`, button: 'Cancel the switch', reasons: ['The new allowance misbehaved', ...REASONS.support],
    consequences: ['A switch that is planned or already made is taken away.', 'This account is back on turns, with its month’s counts.', 'An account that still has the lucy.usage_windows flag is given a new switch date later.'],
  }, async (reason) => {
    const done = await write<{ changed: boolean }>(ctx.api, { path: `${base}/cutover`, method: 'PUT', body: { when: now ? 'now' : 'cancel', reason } });
    if (now) return `${email} is switched over. It applies while the account has the lucy.usage_windows flag.`;
    return done.changed ? `${email}’s switch is cancelled. The account is back on turns.` : `${email} had no switch to cancel.`;
  });
  return (
    <section className="admin-config" aria-label="Lucy allowance">
      <h3>Lucy allowance</h3>
      <p className="admin-note">Lucy’s session and week allowance for this account. This page can’t show the current factor or switch yet; each change is in Staff activity with its reason. Not for your own workspace.</p>
      <div className="admin-inline-form">
        <label>Factor (0 to 100; 1 is the plan’s own allowance)
          <input value={factor} inputMode="decimal" autoComplete="off" aria-invalid={invalid || undefined} onChange={(event) => { setFactor(event.target.value); setInvalid(false); }} />
        </label>
        <ActionButton permission={NEEDS} onPress={setTo}>Set factor…</ActionButton>
      </div>
      {invalid && <p className="admin-error" role="alert">Type a number from 0 to 100, with at most three decimal places.</p>}
      <div className="admin-actions">
        <ActionButton permission={NEEDS} danger onPress={off}>Switch Lucy off…</ActionButton>
        <ActionButton permission={NEEDS} onPress={plan}>Back to the plan’s allowance…</ActionButton>
        <ActionButton permission={NEEDS} onPress={() => cutover(true)}>Switch over now…</ActionButton>
        <ActionButton permission={NEEDS} onPress={() => cutover(false)}>Cancel the switch…</ActionButton>
      </div>
      {last && <p role="status" className="admin-result">{last}</p>}
    </section>
  );
}

type Spread = { count: number; mean: number | null; p50: number | null; p90: number | null; p99: number | null };
type PlanUsage = {
  status: string; cost_per_turn_usd: Spread; turns_per_session: Spread; sessions_per_active_week: Spread; weekly_account_cost_usd: Spread;
  accounts_reaching_session_share: number | null; accounts_reaching_week_share: number | null; platform_cost_usd: number;
};
type UsageReport = { since: number; until: number; catalogue_version: number | string; plans: Record<string, PlanUsage> };

const NONE = 'n/a';
const fixed = (value: number | null, places: number) => value === null ? NONE : value.toFixed(places);
const share = (value: number | null) => value === null ? NONE : `${Math.round(value * 100)}%`;

/** The shadow measurement of Lucy's usage per plan (read only): what the proposed session and
 * week allowance would have meant over the last 28 days. Ids never leave the server. */
export function LucyUsageReport({ api }: { api: AdminFetch }) {
  const loaded = useLoad(() => api<{ report: UsageReport }>('/admin/economics/lucy-usage'), [api]);
  const report = loaded.data?.report;
  const rows = Object.entries(report?.plans ?? {}).map(([plan, usage]) => ({ plan, ...usage }));
  return (
    <Panel title="Lucy usage, last 28 days">
      <Failure error={loaded.error} />
      {report && <p className="admin-note">Measured in shadow from {when(report.since)} to {when(report.until)}, against catalogue version {report.catalogue_version}. A plan with fewer than 30 turns or no complete week says Insufficient data.</p>}
      <DataTable stacked="auto" caption="Lucy usage by plan" rows={rows} rowKey={(r) => r.plan} empty={report ? 'No plans.' : 'Loading the report.'}
        columns={[{ key: 'plan', label: 'Plan', render: (r) => words(r.plan) }, { key: 'status', label: 'Status', render: (r) => words(r.status) },
          { key: 'turns', label: 'Turns', numeric: true, render: (r) => r.cost_per_turn_usd.count },
          { key: 'turn_cost', label: 'Median cost per turn ($)', numeric: true, render: (r) => fixed(r.cost_per_turn_usd.p50, 4) },
          { key: 'session_turns', label: 'Median turns per session', numeric: true, render: (r) => fixed(r.turns_per_session.p50, 0) },
          { key: 'week_sessions', label: 'Median sessions per active week', numeric: true, render: (r) => fixed(r.sessions_per_active_week.p50, 0) },
          { key: 'week_cost', label: 'Median weekly cost per account ($)', numeric: true, render: (r) => fixed(r.weekly_account_cost_usd.p50, 2) },
          { key: 'session_share', label: 'Accounts reaching the session limit', numeric: true, render: (r) => share(r.accounts_reaching_session_share) },
          { key: 'week_share', label: 'Accounts reaching the week limit', numeric: true, render: (r) => share(r.accounts_reaching_week_share) },
          { key: 'platform_cost', label: 'Platform cost ($)', numeric: true, render: (r) => fixed(r.platform_cost_usd, 2) }]} />
    </Panel>
  );
}
