import { useLoad } from './parts';
import { ActionButton, careful, useConsole, write } from './safety';
import { AdminTable, Badge, Empty, Problem, Section, Time, words } from './ui';

type Session = { id: string; status: string | null; active: boolean; created_at: number | null };
type SignIns = { connected: boolean; needs?: string; link?: string; error?: string; email_verified?: boolean; sessions?: Session[] };

/** A customer's sign-ins as WorkOS has them now, each revocable (doc 07b §7B.13). */
export function SignInsPanel({ userId }: { userId: string }) {
  const ctx = useConsole();
  const data = useLoad(() => ctx.api<SignIns>(`/admin/customers/${userId}/sign-ins`), [ctx.api, userId]);
  const d = data.data;
  if (data.error) return <Problem error={data.error} onRetry={() => void data.reload()} />;
  if (!d) return <p className="admin-soft" aria-busy="true">Asking WorkOS…</p>;
  if (!d.connected) return <Section title="Sign-ins"><p>Not connected: add <code>{d.needs}</code> to the API service’s environment. <a href={d.link} target="_blank" rel="noreferrer">WorkOS dashboard</a></p></Section>;
  if (d.error) return <Section title="Sign-ins"><Problem error={d.error} onRetry={() => void data.reload()} /></Section>;
  const revoke = (s: Session) => careful(ctx, () => write(ctx.api, { path: `/admin/customers/${userId}/sign-ins/${s.id}/revoke`, body: { reason: 'Signed out one device from the console' } }).then(() => data.reload()), 'That sign-in has ended. They sign in again on that device.');
  return (
    <Section title="Sign-ins" help="Read from WorkOS just now. Ending one signs out that device only; Sign out everywhere ends them all.">
      <p>Email {d.email_verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Not verified</Badge>}</p>
      <AdminTable caption="Sign-ins" rows={d.sessions ?? []} rowKey={(s) => s.id}
        empty={<Empty title="No sign-ins.">The customer is signed out everywhere.</Empty>}
        cols={[{ key: 'created_at', label: 'Started', render: (s) => <Time at={s.created_at} /> }, { key: 'status', label: 'State', render: (s) => <Badge tone={s.active ? 'ok' : 'neutral'}>{words(s.status ?? (s.active ? 'active' : 'ended'))}</Badge> },
          { key: 'do', label: '', render: (s) => (s.active ? <ActionButton permission="security.sessions.revoke" onPress={() => void revoke(s)}>End this sign-in</ActionButton> : null) }]} />
    </Section>
  );
}
