import { DataTable } from '../ui/DataTable';
import { ELLIPSIS } from '../ui/format';
import { AdminFetch } from './adminApi';
import { EmergencyControls } from './EmergencyPage';
import { Failure, Panel, useLoad } from './parts';

type Deployment = { id: string; provider: string; model_id: string; min_tier: string; status: string; rollout_percent: number; fallback_id: string | null; per_turn_cost_cap_usd: number; emergency_disabled: boolean };
type Routing = { routing_version: number; map: Record<string, Record<string, string[]>>; lucy_disabled: boolean; deployments: Deployment[] };

export function AiPage({ api, can }: { api: AdminFetch; can: (permission: string) => boolean }) {
  const routing = useLoad(() => api<Routing>('/admin/ai'), [api]);
  const rows = Object.entries(routing.data?.map ?? {}).flatMap(([tier, classes]) => Object.entries(classes).map(([cls, ids]) => ({ tier, cls, ids })));
  return (
    <div className="admin-page">
      <Failure error={routing.error} />
      {routing.data?.lucy_disabled && <p className="admin-error" role="status">Lucy is switched off by an emergency control.</p>}
      <div data-tour="routing"><Panel title={`Tier routing (version ${routing.data?.routing_version ?? ELLIPSIS})`}>
        <DataTable stacked="auto" caption="Tier to deployment" rows={rows} rowKey={(r) => `${r.tier}/${r.cls}`} empty="No routing."
          columns={[{ key: 'tier', label: 'Tier' }, { key: 'cls', label: 'Request class' }, { key: 'ids', label: 'Deployments, in order', render: (r) => r.ids.join(' then ') }]} />
      </Panel></div>
      <div data-tour="deployments"><Panel title="Deployments">
        <DataTable stacked="auto" caption="Deployments" rows={routing.data?.deployments ?? []} rowKey={(d) => d.id} empty="No deployments."
          columns={[{ key: 'id', label: 'Deployment' }, { key: 'model_id', label: 'Model' }, { key: 'min_tier', label: 'Lowest tier' },
            { key: 'status', label: 'Status', render: (d) => d.emergency_disabled ? 'disabled (emergency)' : d.status },
            { key: 'rollout_percent', label: 'Rollout %', numeric: true }, { key: 'fallback_id', label: 'Falls back to', render: (d) => d.fallback_id ?? 'built-in' },
            { key: 'per_turn_cost_cap_usd', label: 'Cost cap per turn ($)', numeric: true }]} />
      </Panel></div>
      <div data-tour="ai-emergency"><EmergencyControls only={['lucy.disabled', 'lucy.deployment_disabled']} /></div>
    </div>
  );
}
