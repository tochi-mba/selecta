import { FormEvent, useState } from 'react';
import { useLoad } from './parts';
import { ActionButton, careful, useConsole, write } from './safety';
import { AdminTable, Badge, CopyId, Empty, Problem, Section, Time, words } from './ui';

type Notice = { id: string; workspace_id: string; asset_id: string; complainant: string; work: string; status: string; received_at: number; due_by: number; overdue: boolean };

/** Copyright notices with their deadlines, overdue first (doc 07b §7B.4, Content). */
export function ContentPage() {
  const ctx = useConsole();
  const notices = useLoad(() => ctx.api<{ notices: Notice[] }>('/admin/takedowns'), [ctx.api]);
  const [form, setForm] = useState({ workspace_id: '', asset_id: '', complainant: '', work: '' });
  const rows = [...(notices.data?.notices ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due_by - b.due_by);
  const log = (event: FormEvent) => {
    event.preventDefault();
    void careful(ctx, () => write(ctx.api, { path: '/admin/takedowns', body: form }).then(() => { setForm({ workspace_id: '', asset_id: '', complainant: '', work: '' }); void notices.reload(); }), 'Notice logged. Decide it before its due date.');
  };
  const act = (n: Notice) => ctx.ask({
    action: 'takedown.act', title: `Act on the notice for "${n.work}"`, button: 'Hide the song and start its deletion',
    consequences: ['The song is hidden from the customer at once.', 'Its deletion starts.', 'Repeated valid notices restrict the customer’s uploads.'],
    confirmText: n.id.slice(0, 8), confirmLabel: `Type ${n.id.slice(0, 8)} (the notice’s first 8 characters) to confirm`, reasons: ['Valid notice', 'Rights holder confirmed'], irreversible: true,
    run: async (reason, confirm) => { await write(ctx.api, { path: `/admin/takedowns/${n.id}/act`, body: { reason, confirm } }); ctx.toast({ text: 'Notice acted on; the song is hidden.', tone: 'ok' }); await notices.reload(); },
    done: 'Done.',
  });
  const reject = (n: Notice) => careful(ctx, () => write(ctx.api, { path: `/admin/takedowns/${n.id}/reject`, body: { reason: 'Notice not valid' } }).then(() => notices.reload()), 'Notice rejected; the song stays.');
  return (
    <div className="admin-page">
      <Problem error={notices.error} onRetry={() => void notices.reload()} />
      <Section title="Notices" tour="notices">
        <AdminTable caption="Takedown notices" rows={rows} rowKey={(n) => n.id} loading={!notices.data}
          empty={<Empty title="No notices.">When a rights holder sends a takedown, log it here; it is decided within its deadline.</Empty>}
          cols={[{ key: 'work', label: 'Work' }, { key: 'complainant', label: 'From' }, { key: 'workspace_id', label: 'Workspace', render: (n) => <CopyId id={n.workspace_id} label="workspace id" /> },
            { key: 'due_by', label: 'Due', sort: (n) => n.due_by, render: (n) => (n.overdue ? <Badge tone="bad">Overdue</Badge> : <Time at={n.due_by} />) },
            { key: 'status', label: 'Status', render: (n) => words(n.status) },
            { key: 'decide', label: 'Decide', render: (n) => (n.status === 'received' ? <span className="admin-actions">
              <ActionButton permission="legal.takedowns.manage" onPress={() => void reject(n)}>Reject</ActionButton>
              <ActionButton permission="legal.takedowns.manage" danger onPress={() => act(n)}>Act…</ActionButton></span> : null) }]} />
      </Section>
      {ctx.can('legal.takedowns.manage') && <Section title="Log a notice" tour="log-notice">
        <form className="admin-inline-form" onSubmit={log}>
          {(['workspace_id', 'asset_id', 'complainant', 'work'] as const).map((key) => (
            <label key={key}>{{ workspace_id: 'Workspace id', asset_id: 'Song (asset) id', complainant: 'Complainant', work: 'Work claimed' }[key]}
              <input required value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>
          ))}
          <button className="primary" disabled={ctx.changesUntil === null}>Log notice</button>
        </form>
      </Section>}
      <div data-tour="restrictions"><Section title="Repeat infringers"><p className="admin-soft">Accounts whose uploads are restricted show it on their customer record, with Lift.</p></Section></div>
    </div>
  );
}
