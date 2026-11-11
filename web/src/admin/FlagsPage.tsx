import { FormEvent, useMemo, useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, post, when } from './adminApi';
import { Command, Failure, Panel, useLoad } from './parts';

type Rule = { kind: string; params: Record<string, unknown>; enabled: boolean };
type Flag = { id: string; area: string; label: string; about: string; core: boolean; targetable: boolean; build_on: boolean; kind: string; requires: string[]; rules: Rule[] };
type Counts = { total: number; changed: number; turned_on: number; turned_off: number };
type Impact = { accounts: number; flags: Record<string, Counts & { by_plan: Record<string, Counts> }>; dependents: string[]; broad: boolean; rules: Rule[] };
type Outcome = { applied: boolean; version: number | null; action_id: string | null; execute_after: number | null; warnings: string[] };
type Version = { version: number; flag_id: string; change: string; author: string; reason: string; created_at: number; rules: Rule[] };
type Trace = { user_id: string; plan: string; rule_version: number; flags: { flag_id: string; on: boolean; reason: string; steps: { layer: string; on: boolean | null; reason: string; detail: string }[] }[] };

export type FlagAction = 'kill_switch' | 'off_for_tier' | 'off_for_users' | 'rollout' | 'schedule';
const ACTIONS: { id: FlagAction; label: string }[] = [
  { id: 'kill_switch', label: 'Off for everyone' },
  { id: 'off_for_tier', label: 'Off for a tier' },
  { id: 'off_for_users', label: 'Off for these users' },
  { id: 'rollout', label: 'Roll out to a share' },
  { id: 'schedule', label: 'Schedule' },
];
const PLANS = ['free', 'standard', 'premium'];

function describe(rule: Rule) {
  const p = rule.params;
  if (rule.kind === 'kill_switch') return 'Off for everyone';
  if (rule.kind === 'segment') return `${p.on ? 'On' : 'Off'} for ${(p.plans as string[] | undefined)?.join(', ') ?? 'a segment'}`;
  if (rule.kind === 'users') return `${p.on ? 'On' : 'Off'} for ${(p.ids as string[]).length} users`;
  if (rule.kind === 'percentage') return `${p.percent}% rollout${p.plans ? ` of ${(p.plans as string[]).join(', ')}` : ''}`;
  if (rule.kind === 'schedule') return `${p.on === false ? 'Off' : 'On'} ${p.from ? `from ${when(p.from as number)}` : ''} ${p.until ? `until ${when(p.until as number)}` : ''}`.trim();
  return rule.kind;
}

/** The page form's values as the API's action parameters. */
export function paramsFor(action: FlagAction, form: { plan: string; users: string; percent: number; from: string; until: string }) {
  if (action === 'off_for_tier') return { plan: form.plan };
  if (action === 'off_for_users') return { user_ids: form.users.split(/[\s,]+/).filter(Boolean) };
  if (action === 'rollout') return { percent: form.percent, plans: form.plan ? [form.plan] : undefined };
  if (action === 'schedule') {
    const at = (text: string) => (text ? Math.floor(new Date(text).getTime() / 1000) : undefined);
    return { from: at(form.from), until: at(form.until), on: true };
  }
  return {};
}

export function FlagsPage({ api, can }: { api: AdminFetch; can: (permission: string) => boolean }) {
  const list = useLoad(() => api<{ flags: Flag[] }>('/admin/flags'), [api]);
  const [picked, setPicked] = useState<string | null>(null);
  const areas = useMemo(() => {
    const out = new Map<string, Flag[]>();
    for (const flag of list.data?.flags ?? []) out.set(flag.area, [...(out.get(flag.area) ?? []), flag]);
    return [...out.entries()];
  }, [list.data]);
  const flag = list.data?.flags.find((f) => f.id === picked) ?? null;
  return (
    <div className="admin-page">
      <Failure error={list.error} />
      {flag && <FlagDetail api={api} flag={flag} can={can} onChanged={() => void list.reload()} />}
      <Trace api={api} />
      {areas.map(([area, flags]) => (
        <Panel key={area} title={area}>
          <DataTable caption={`${area} flags`} rows={flags} rowKey={(f) => f.id} onPick={(f) => setPicked(f.id)} pickLabel={(f) => `Open flag ${f.id}`}
            columns={[{ key: 'id', label: 'Flag' }, { key: 'label', label: 'Feature' }, { key: 'build_on', label: 'Build default', render: (f) => f.core ? 'Core' : f.build_on ? 'On' : 'Off' },
              { key: 'rules', label: 'Rules', render: (f) => f.rules.length ? f.rules.map(describe).join('; ') : 'none' }]} />
        </Panel>
      ))}
    </div>
  );
}

function FlagDetail({ api, flag, can, onChanged }: { api: AdminFetch; flag: Flag; can: (p: string) => boolean; onChanged: () => void }) {
  const [action, setAction] = useState<FlagAction>('kill_switch');
  const [form, setForm] = useState({ plan: 'free', users: '', percent: 10, from: '', until: '' });
  const [impact, setImpact] = useState<Impact | null>(null);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const history = useLoad(() => api<{ versions: Version[] }>(`/admin/flags/history?flag_id=${encodeURIComponent(flag.id)}`), [api, flag.id]);
  const body = (reason = '') => ({ action, reason, params: paramsFor(action, form) });
  const preview = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setOutcome('');
    try { setImpact(await api<Impact>(`/admin/flags/${flag.id}/impact`, post(body()))); }
    catch (problem) { setError((problem as Error).message); setImpact(null); }
  };
  const apply = async (reason: string) => {
    const done = await api<Outcome>(`/admin/flags/${flag.id}/change`, post(body(reason)));
    setOutcome(done.applied ? `Saved as version ${done.version}.${done.warnings.length ? ` ${done.warnings.join(' ')}` : ''}`
      : `This is a broad change, so it waits: it runs after ${when(done.execute_after)} unless cancelled (action ${done.action_id?.slice(0, 8)}).`);
    setImpact(null); await history.reload(); onChanged();
  };
  const rollback = async (version: number, reason: string, before = false) => {
    const done = await api<Outcome>('/admin/flags/rollback', post({ version, reason, before }));
    setOutcome(done.applied ? `${before ? 'Undone' : 'Restored'} as version ${done.version}.` : `The rollback is broad, so it waits until ${when(done.execute_after)}.`);
    await history.reload(); onChanged();
  };
  const previewSelf = async (on: boolean, reason: string) => { await api(`/admin/flags/${flag.id}/preview`, post({ on, reason })); setOutcome(on ? 'On for your account only.' : 'Your preview is off.'); };
  const counts = impact?.flags[flag.id];
  return (
    <Panel title={`${flag.label} (${flag.id})`}>
      <p>{flag.about}</p>
      {!flag.targetable ? <p className="admin-note">{flag.core ? 'This is a core feature, so it can’t be targeted.' : 'This flag runs the admin console or staff routes, so it can’t be targeted.'}</p> : <>
        <form className="admin-filters" aria-label="Flag change" onSubmit={(event) => void preview(event)}>
          <label>Action<select value={action} onChange={(event) => { setAction(event.target.value as FlagAction); setImpact(null); }}>
            {ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          {(action === 'off_for_tier' || action === 'rollout') && <label>Tier<select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
            {action === 'rollout' && <option value="">every tier</option>}{PLANS.map((p) => <option key={p}>{p}</option>)}</select></label>}
          {action === 'off_for_users' && <label>User ids<input value={form.users} onChange={(e) => setForm({ ...form, users: e.target.value })} placeholder="comma separated" /></label>}
          {action === 'rollout' && <label>Percent<input type="number" min={0} max={100} value={form.percent} onChange={(e) => setForm({ ...form, percent: Number(e.target.value) })} /></label>}
          {action === 'schedule' && <><label>From<input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
            <label>Until<input type="datetime-local" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></label></>}
          <button className="primary">Preview impact</button>
        </form>
        <Failure error={error} />
        {impact && <div className="admin-impact" aria-label="Impact preview">
          <p><strong>{counts?.changed ?? 0}</strong> of {impact.accounts} accounts change ({counts?.turned_off ?? 0} lose it, {counts?.turned_on ?? 0} gain it).</p>
          <DataTable caption="By plan" rows={Object.entries(counts?.by_plan ?? {})} rowKey={([plan]) => plan}
            columns={[{ key: 'plan', label: 'Plan', render: ([plan]) => plan }, { key: 'changed', label: 'Accounts changing', numeric: true, render: ([, c]) => String(c.changed) }, { key: 'total', label: 'Accounts', numeric: true, render: ([, c]) => String(c.total) }]} />
          {impact.dependents.length > 0 && <p>These follow it, because they need it: {impact.dependents.join(', ')}.</p>}
          {impact.broad && action !== 'kill_switch' && <p className="admin-note">This is a broad change: it will wait 15 minutes before it runs.</p>}
          {action === 'kill_switch' && <p className="admin-note">A kill switch is instant and alerts every Owner.</p>}
          {(can('flags.rules.propose') || can('flags.kill_switch') || can('flags.user_override')) && <Command danger={action === 'kill_switch'} label={`Apply: ${ACTIONS.find((a) => a.id === action)?.label}`} run={apply} />}
        </div>}
        {can('flags.preview_self') && <div className="admin-actions" aria-label="Preview on my account">
          <Command label="Preview on my account" run={(r) => previewSelf(true, r)} />
          <Command label="End my preview" run={(r) => previewSelf(false, r)} />
        </div>}
      </>}
      {outcome && <p role="status">{outcome}</p>}
      <h3>History</h3>
      <Failure error={history.error} />
      <DataTable caption="Rule versions" rows={history.data?.versions ?? []} rowKey={(v) => String(v.version)} empty="No changes yet."
        columns={[{ key: 'version', label: 'Version', numeric: true }, { key: 'change', label: 'Change' }, { key: 'rules', label: 'Rules', render: (v) => v.rules.map(describe).join('; ') || 'none' },
          { key: 'author', label: 'By' }, { key: 'reason', label: 'Why' }, { key: 'created_at', label: 'When', render: (v) => when(v.created_at) },
          { key: 'rollback', label: 'Rollback', render: (v) => can('flags.rules.propose') && v.change !== 'preview_on' && v.change !== 'preview_off' ? <>
            <Command label={`Restore version ${v.version}`} run={(r) => rollback(v.version, r)} />
            <Command label={`Undo version ${v.version}`} run={(r) => rollback(v.version, r, true)} /></> : null }]} />
    </Panel>
  );
}

function Trace({ api }: { api: AdminFetch }) {
  const [userId, setUserId] = useState('');
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState('');
  const [onlyOff, setOnlyOff] = useState(true);
  const run = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try { setTrace(await api<Trace>(`/admin/flags/explain/${encodeURIComponent(userId.trim())}`)); }
    catch (problem) { setError((problem as Error).message); setTrace(null); }
  };
  const rows = (trace?.flags ?? []).filter((f) => !onlyOff || !f.on);
  return (
    <Panel title="What does this user see, and why?">
      <form className="admin-filters" aria-label="Decision trace" onSubmit={(event) => void run(event)}>
        <label>User id<input value={userId} onChange={(e) => setUserId(e.target.value)} required /></label>
        <label className="admin-check"><input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} /> Only features that are off</label>
        <button className="primary">Explain</button>
      </form>
      <Failure error={error} />
      {trace && <DataTable caption={`Decisions for ${trace.user_id} on ${trace.plan} (rules version ${trace.rule_version})`} rows={rows} rowKey={(f) => f.flag_id} empty="Every feature is on."
        columns={[{ key: 'flag_id', label: 'Flag' }, { key: 'on', label: 'Decision', render: (f) => f.on ? 'On' : 'Off' }, { key: 'reason', label: 'Reason' },
          { key: 'steps', label: 'Each layer', render: (f) => f.steps.map((s) => `${s.layer}: ${s.on === null ? 'n/a' : s.on ? 'yes' : 'no'} (${s.reason})`).join(' · ') }]} />}
    </Panel>
  );
}
