import { useMemo, useState } from 'react';
import { AccountsPage } from './AccountsPage';
import { AdminError, adminFetch, Me, startAdminSession, TokenSource, when } from './adminApi';
import { AiPage, SecurityPage } from './AiSecurityPages';
import { FlagsPage } from './FlagsPage';
import { JobsPage } from './JobsPage';
import { OverviewPage } from './OverviewPage';
import './admin.css';

export type AdminPage = 'overview' | 'jobs' | 'accounts' | 'ai' | 'security' | 'flags';

/** The six pages (§7.5), each shown only to roles that can read it. The server checks again. */
export const PAGES: { id: AdminPage; label: string; needs: string }[] = [
  { id: 'overview', label: 'Overview', needs: 'platform.dashboard.read' },
  { id: 'jobs', label: 'Jobs & workers', needs: 'jobs.read' },
  { id: 'accounts', label: 'Accounts & billing', needs: 'accounts.list' },
  { id: 'ai', label: 'AI routing', needs: 'models.read' },
  { id: 'security', label: 'Security', needs: 'security.audit.read' },
  { id: 'flags', label: 'Flags', needs: 'flags.read' },
];

export function adminPageFor(pathname: string): AdminPage {
  const part = pathname.replace(/^\/admin\/?/, '').split('/')[0];
  return (PAGES.find((page) => page.id === part)?.id) ?? 'overview';
}

/**
 * The staff console. It starts by entering an admin session (which needs a sign-in from the last
 * five minutes), keeps that session in memory only, and draws the pages the session's roles can
 * read. Every action still goes to the server, which decides.
 */
export default function AdminArea({ token, onLeave, origin }: { token: TokenSource; onLeave: () => void; origin?: string }) {
  const [session, setSession] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [page, setPage] = useState<AdminPage>(() => adminPageFor(window.location.pathname));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const api = useMemo(() => session ? adminFetch(token, session, origin) : null, [token, session, origin]);

  const enter = async () => {
    setBusy(true); setError('');
    try {
      const started = await startAdminSession(token, origin);
      const fetcher = adminFetch(token, started.id, origin);
      setMe(await fetcher<Me>('/admin/me'));
      setSession(started.id);
    } catch (problem) { setError(problem instanceof AdminError ? problem.message : (problem as Error).message); }
    finally { setBusy(false); }
  };

  const go = (next: AdminPage) => {
    setPage(next);
    const path = `/admin/${next}`;
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
  };

  if (!api || !me) {
    return (
      <main className="admin-enter">
        <p className="cloud-eyebrow">STAFF CONSOLE</p>
        <h1>Enter the admin console</h1>
        <p>An admin session lasts at most an hour and needs a sign-in from the last five minutes.</p>
        <div className="cloud-actions"><button className="primary" onClick={() => void enter()} disabled={busy}>{busy ? 'Entering…' : 'Enter console'}</button><button onClick={onLeave}>Back to my workspace</button></div>
        {error && <p className="admin-error" role="alert">{error}</p>}
      </main>
    );
  }

  const can = (permission: string) => me.permissions.includes(permission);
  const visible = PAGES.filter((p) => can(p.needs));
  const current = visible.find((p) => p.id === page) ?? visible[0];
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div><p className="cloud-eyebrow">STAFF CONSOLE</p><h1>{current?.label ?? 'Nothing to show'}</h1></div>
        <div className="admin-who"><span>{me.roles.map((r) => `${r.title} (${r.scope})`).join(', ')}</span><small>Session ends {when(me.session.expires_at)}</small><button onClick={onLeave}>Leave console</button></div>
      </header>
      <nav className="admin-nav" aria-label="Admin pages">
        {visible.map((p) => <button key={p.id} aria-current={current?.id === p.id ? 'page' : undefined} onClick={() => go(p.id)}>{p.label}</button>)}
      </nav>
      <main className="admin-main">
        {!current && <p>Your roles don't include any console page.</p>}
        {current?.id === 'overview' && <OverviewPage api={api} can={can} />}
        {current?.id === 'jobs' && <JobsPage api={api} can={can} />}
        {current?.id === 'accounts' && <AccountsPage api={api} can={can} />}
        {current?.id === 'ai' && <AiPage api={api} can={can} />}
        {current?.id === 'security' && <SecurityPage api={api} can={can} me={me.user_id} />}
        {current?.id === 'flags' && <FlagsPage api={api} can={can} />}
      </main>
    </div>
  );
}
