import { useLoad } from './parts';
import { useConsole } from './safety';
import { Badge, CopyId, Problem, Section, Skeleton, words } from './ui';

type System = {
  environment: string; api_version: string | null;
  migration: { code_head: string | null; database: string[]; matches: boolean };
  settings: { name: string; for: string; set: boolean }[];
  integrations?: { id: string; name: string; connected: boolean; needs: string; unlocks: string; link: string }[];
};

/** System (doc 07b §7B.4): what is deployed, schema against code, settings set or missing. */
export function SystemPage() {
  const { api } = useConsole();
  const data = useLoad(() => api<System>('/admin/system'), [api]);
  const s = data.data;
  if (data.error) return <Problem error={data.error} onRetry={() => void data.reload()} />;
  if (!s) return <Skeleton rows={6} label="Loading system facts" />;
  const missing = s.settings.filter((x) => !x.set);
  return (
    <div className="admin-page">
      <Section title="Deployed" tour="deploy">
        <dl className="admin-facts">
          <div><dt>Environment</dt><dd>{words(s.environment)}</dd></div>
          <div><dt>API commit</dt><dd>{s.api_version ? <CopyId id={s.api_version} label="commit" /> : <span className="admin-soft">Not reported (set by Render as RENDER_GIT_COMMIT)</span>}</dd></div>
          <div><dt>Database schema</dt><dd>{s.migration.matches ? <Badge tone="ok">Matches the code ({s.migration.code_head})</Badge> : <Badge tone="bad">Database {s.migration.database.join(', ') || 'empty'}, code {s.migration.code_head}: run selecta db upgrade</Badge>}</dd></div>
        </dl>
      </Section>
      <Section title="Settings" tour="settings" help="Each setting the service needs, set or missing. Values are never shown: they live in Render's environment for the API service.">
        {missing.length ? <p className="admin-warning">{missing.length} missing: {missing.map((m) => m.name).join(', ')}.</p> : <p><Badge tone="ok">Every required setting is set.</Badge></p>}
        <ul className="admin-health">{s.settings.map((x) => <li key={x.name}><code>{x.name}</code><span>{x.for}</span>{x.set ? <Badge tone="ok">Set</Badge> : <Badge tone="bad">Missing</Badge>}</li>)}</ul>
      </Section>
      <Section title="Integrations" tour="integrations" help="Outside services the console can reach. Each says whether it is connected and what connecting it unlocks; keys are never shown.">
        <ul className="admin-health">{(s.integrations ?? []).map((i) => (
          <li key={i.id}><strong>{i.name}</strong>{i.connected ? <Badge tone="ok">Connected</Badge> : <Badge>Not connected</Badge>}
            <small className="admin-soft">{i.connected ? i.unlocks : <>Add {i.needs} to unlock: {i.unlocks}. <a href={i.link} target="_blank" rel="noreferrer">Provider’s page</a></>}</small></li>
        ))}</ul>
      </Section>
    </div>
  );
}
