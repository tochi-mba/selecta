import { useState } from 'react';
import { when } from './adminApi';
import { ActionButton, REASONS, useConsole, write } from './safety';
import { AdminTable, Empty, Section, words } from './ui';

type DryRun = { count: number; max: number; too_many: boolean; sample: { workspace_id: string; plan_now: string; plan_after: string }[]; problems: string[]; plan_id: string; expires_at: number; digest: string };

/**
 * Time for many workspaces at once (doc 07b §7B.7, Bulk): always a dry run first (the count, a
 * sample, what changes), then the delayed path quoting the dry run's digest, with the count typed.
 * Changing the list or plan throws the dry run away, so nothing stale is ever run.
 */
export function BulkGrant() {
  const ctx = useConsole();
  const [ids, setIds] = useState('');
  const [plan, setPlan] = useState('premium');
  const [days, setDays] = useState(30);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [error, setError] = useState('');
  const list = ids.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const reset = () => setDry(null);
  const preview = async () => {
    setError('');
    try {
      setDry(await ctx.api<DryRun>('/admin/overrides/mass/dry-run', { method: 'POST', body: JSON.stringify({ workspace_ids: list, plan_id: plan, expires_at: Math.round(Date.now() / 1000 + days * 86_400) }) }));
    } catch (problem) { setError((problem as Error).message); }
  };
  const queue = (run: DryRun) => ctx.ask({
    action: 'override.mass', title: `Grant ${words(run.plan_id)} to ${run.count} workspaces`, button: `Queue: ${words(run.plan_id)} for ${run.count} workspaces`,
    consequences: [`${run.count} workspaces get ${words(run.plan_id)} until ${when(run.expires_at)}.`, 'It waits 15 minutes and alerts every Owner; it can be cancelled until then.', 'Each override expires by itself.'],
    confirmText: String(run.count), confirmLabel: `Type ${run.count} to confirm`, reasons: REASONS.billing, irreversible: false, delayed: true,
    run: async (reason, confirm) => {
      await write(ctx.api, { path: '/admin/overrides/mass', body: { workspace_ids: list, plan_id: run.plan_id, expires_at: run.expires_at, reason, version: run.digest, read_at: Date.now() / 1000, confirm } });
      ctx.toast({ text: `Queued for 15 minutes: ${run.count} overrides. Cancel it from Staff and security, Waiting actions.`, tone: 'ok' });
      setDry(null); setIds('');
    },
    done: 'Queued.',
  });
  if (!ctx.can('billing.overrides.create')) return null;
  return (
    <Section title="Grant time to several customers" tour="bulk-grant" help="A bulk action: always a dry run first, at most 500 a run, and it waits 15 minutes before it runs.">
      <div className="admin-inline-form">
        <label>Workspace ids (one per line or comma separated)<textarea rows={3} value={ids} onChange={(event) => { setIds(event.target.value); reset(); }} /></label>
        <label>Plan<select value={plan} onChange={(event) => { setPlan(event.target.value); reset(); }}><option value="standard">Standard</option><option value="premium">Premium</option></select></label>
        <label>Days<input type="number" min={1} max={366} value={days} onChange={(event) => { setDays(Number(event.target.value)); reset(); }} /></label>
        <button type="button" disabled={list.length < 2} onClick={() => void preview()}>Dry run</button>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {dry && <div className="admin-dry-run" role="region" aria-label="Dry run">
        <p><strong>{dry.count} workspaces</strong> would get {words(dry.plan_id)} until {when(dry.expires_at)}.{dry.too_many && ` That is over the limit of ${dry.max} a run.`}</p>
        {dry.problems.length > 0 && <ul className="admin-error">{dry.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <AdminTable caption="Sample of what changes" rows={dry.sample} rowKey={(s) => s.workspace_id} empty={<Empty title="No valid workspaces." />}
          cols={[{ key: 'workspace_id', label: 'Workspace' }, { key: 'plan_now', label: 'Plan now', render: (s) => words(s.plan_now) }, { key: 'plan_after', label: 'Plan after', render: (s) => words(s.plan_after) }]} />
        {!dry.too_many && dry.problems.length === 0 && <ActionButton permission="billing.overrides.create" onPress={() => queue(dry)}>Queue the grant…</ActionButton>}
      </div>}
    </Section>
  );
}
