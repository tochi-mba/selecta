// S8 Pilot administration (ADR-0453 D1, ADR-0452 BZ-0452-13): REX Technologies staff see every
// pilot organisation, its use against its allowance and its end date, and extend, change the
// allowance, convert or end one. Each change asks for a reason, which the server audits. Shown
// only to staff holding `business.pilots.create`; the server checks again and refuses while
// `business.pilots` is off.

import { useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, post, when } from './adminApi';
import { Command, Failure, Panel, useLoad } from './parts';

export type PilotRow = {
  id: string; org_id: string; org_name: string; owner_email: string; venues_used: number; zones_used: number;
  allowance: { venues: number; zones: number }; starts_at: number; ends_at: number;
  status: 'active' | 'ending' | 'ended' | 'converted' | 'pending'; note?: string | null;
};

const DAY = 86_400;
const STATUS_WORDS: Record<PilotRow['status'], string> = { active: 'Active', ending: 'Ending within 14 days', ended: 'Ended', converted: 'Converted to paid', pending: 'Waiting for the owner' };

export function PilotsPage({ api }: { api: AdminFetch }) {
  const pilots = useLoad(() => api<{ pilots: PilotRow[] }>('/admin/business/pilots'), [api]);
  const [picked, setPicked] = useState<string | null>(null);
  const pilot = pilots.data?.pilots.find((row) => row.id === picked) ?? null;
  return (
    <div className="admin-page">
      <Panel title="Pilot organisations">
        <p className="admin-note">Free pilots made by REX Technologies staff: no card and no charge. Every change needs a reason and is audited.</p>
        <Failure error={pilots.error} />
        <DataTable stacked="auto" caption="Pilots" rows={pilots.data?.pilots ?? []} rowKey={(row) => row.id} onPick={(row) => setPicked(row.id)} pickLabel={(row) => `Open ${row.org_name}`}
          empty="No pilots yet."
          columns={[
            { key: 'org_name', label: 'Organisation' },
            { key: 'owner_email', label: 'Owner' },
            { key: 'venues_used', label: 'Venues', numeric: true, render: (row) => `${row.venues_used} of ${row.allowance.venues}` },
            { key: 'zones_used', label: 'Zones', numeric: true, render: (row) => `${row.zones_used} of ${row.allowance.zones}` },
            { key: 'ends_at', label: 'Ends', render: (row) => when(row.ends_at) },
            { key: 'status', label: 'Status', render: (row) => STATUS_WORDS[row.status] ?? row.status },
          ]} />
      </Panel>
      {pilot && <PilotDetail api={api} pilot={pilot} reload={pilots.reload} />}
    </div>
  );
}

function PilotDetail({ api, pilot, reload }: { api: AdminFetch; pilot: PilotRow; reload: () => Promise<void> }) {
  const [days, setDays] = useState(30);
  const [venues, setVenues] = useState(pilot.allowance.venues);
  const [zones, setZones] = useState(pilot.allowance.zones);
  const finished = pilot.status === 'converted' || pilot.status === 'ended';
  const run = (action: string, extra: Record<string, unknown> = {}) => async (reason: string) => {
    await api(`/admin/business/pilots/${encodeURIComponent(pilot.id)}/${action}`, post({ reason, ...extra }));
    await reload();
  };
  const latest = pilot.starts_at + 180 * DAY;
  const extendTo = Math.min(latest, Math.max(pilot.ends_at, Date.now() / 1000) + days * DAY);
  return (
    <Panel title={pilot.org_name}>
      <p>{STATUS_WORDS[pilot.status]}. Started {when(pilot.starts_at)}, ends {when(pilot.ends_at)}. A pilot lasts at most 180 days (until {when(latest)}).</p>
      {pilot.status !== 'converted' && <div className="admin-filters">
        <label>Extend by days<input type="number" min={1} max={180} value={days} onChange={(event) => setDays(Math.max(1, Number(event.target.value) || 1))} /></label>
        <Command label="Extend pilot" run={run('extend', { ends_at: extendTo })} note={`The pilot will end ${when(extendTo)}.`} />
      </div>}
      {!finished && <>
        <div className="admin-filters">
          <label>Venues<input type="number" min={1} max={20} value={venues} onChange={(event) => setVenues(Number(event.target.value) || 1)} /></label>
          <label>Zones<input type="number" min={1} max={100} value={zones} onChange={(event) => setZones(Number(event.target.value) || 1)} /></label>
          <Command label="Change allowance" run={run('allowance', { allowance: { venues, zones } })} />
        </div>
        <Command label="Convert to paid" run={run('convert')} note="The pilot ends now and the owner subscribes on the organisation's Billing page." />
        <Command label="End pilot" danger run={run('end')} note="Management turns read-only and music stops at each venue's next close. Nothing is deleted for 90 days." />
      </>}
    </Panel>
  );
}
