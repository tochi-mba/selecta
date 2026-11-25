import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkProfile } from '../business/feelBits';
import { AdminError, adminFetch, Me, startAdminSession, TokenSource, when } from './adminApi';
import { AiPage } from './AiSecurityPages';
import { BillingPage } from './BillingPage';
import { CommsPage } from './CommsPage';
import { ContentPage } from './ContentPage';
import { CoversPage } from './CoversPage';
import { CustomersPage } from './CustomersPage';
import { EmergencyPage } from './EmergencyPage';
import { FlagsPage } from './FlagsPage';
import { HelpPanel, Palette, PlaybookView, Tour, Welcome } from './Guide';
import { JobsPage } from './JobsPage';
import { OverviewPage } from './OverviewPage';
import { PilotsPage } from './PilotsPage';
import { adminPath, go, parseAdmin } from './route';
import { ConsoleContext, DangerDialog, DangerRequest, needsWords, Toast, Toasts } from './safety';
import { StaffPage } from './StaffPage';
import { SystemPage } from './SystemPage';
import { WorkersPage } from './WorkersPage';
import './admin.css';

export type AdminPage = 'overview' | 'customers' | 'billing' | 'jobs' | 'workers' | 'ai' | 'flags' | 'content' | 'covers' | 'emergency' | 'security' | 'communications' | 'system' | 'pilots';

/** The pages (doc 07b §7B.4), each shown only to roles that can read it and when its flag is on. */
export const PAGES: { id: AdminPage; label: string; needs: string; flag?: string }[] = [
  { id: 'overview', label: 'Overview', needs: 'platform.dashboard.read' },
  { id: 'customers', label: 'Customers', needs: 'accounts.list' },
  { id: 'billing', label: 'Billing', needs: 'billing.subscriptions.read' },
  { id: 'jobs', label: 'Jobs', needs: 'jobs.read' },
  // Its own sidebar item, not a tab on Jobs: it is where staff look first when hosted processing
  // stalls, so it must be one click from anywhere (doc 07b §7B.4, Workers).
  { id: 'workers', label: 'Workers', needs: 'jobs.read', flag: 'admin.workers' },
  { id: 'ai', label: 'AI', needs: 'models.read' },
  { id: 'flags', label: 'Flags', needs: 'flags.read' },
  { id: 'content', label: 'Content', needs: 'legal.takedowns.read' },
  // Finding a cover needs the same permission as hiding one (the server's read route checks it),
  // and there is nothing to hide while web lookups are off, so the page follows their flag.
  { id: 'covers', label: 'Catalogue covers', needs: 'legal.takedowns.manage', flag: 'library.art_lookup' },
  { id: 'emergency', label: 'Emergency', needs: 'platform.dashboard.read' },
  { id: 'security', label: 'Staff and security', needs: 'security.audit.read' },
  { id: 'communications', label: 'Communications', needs: 'platform.dashboard.read' },
  { id: 'system', label: 'System', needs: 'platform.dashboard.read' },
  { id: 'pilots', label: 'Business pilots', needs: 'business.pilots.create', flag: 'business.pilots' },
];

export function adminPageFor(pathname: string): AdminPage {
  return parseAdmin(pathname).page;
}

const ENV_NAMES: Record<string, string> = { production: 'Production', staging: 'Staging', development: 'Local' };

/**
 * The staff console. Entering starts an admin session (a sign-in from the last five minutes);
 * the session lives in memory and a reload re-enters while the sign-in is fresh. The console opens
 * in view mode; every action still goes to the server, which decides.
 */
export default function AdminArea({ token, onLeave, origin, email, features, onSignInAgain }: {
  token: TokenSource; onLeave: () => void; origin?: string; email?: string;
  features?: Readonly<Record<string, boolean>> | null; onSignInAgain?: () => void;
}) {
  // a work tool: the component feel stays, nothing here answers the music (ADR-0477 plan 3.14)
  useWorkProfile();
  const [session, setSession] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [location, setLocation] = useState(() => parseAdmin(window.location.pathname, window.location.search));
  const [error, setError] = useState<AdminError | null>(null);
  const [busy, setBusy] = useState(false);
  const [changesUntil, setChangesUntil] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [danger, setDanger] = useState<DangerRequest | null>(null);
  const [overlay, setOverlay] = useState<'help' | 'palette' | 'tour' | null>(null);
  const [welcome, setWelcome] = useState(false);
  const api = useMemo(() => session ? adminFetch(token, session, origin) : null, [token, session, origin]);

  const enter = useCallback(async (quiet = false) => {
    setBusy(true); if (!quiet) setError(null);
    try {
      const started = await startAdminSession(token, origin);
      const fetcher = adminFetch(token, started.id, origin);
      const found = await fetcher<Me>('/admin/me');
      setMe(found); setSession(started.id); setChangesUntil(found.changes_until ?? null);
      setWelcome(!(found.preferences?.welcome));
    } catch (problem) { if (!quiet) setError(problem instanceof AdminError ? problem : new AdminError((problem as Error).message, 0)); }
    finally { setBusy(false); }
  }, [token, origin]);

  // A reload or a deep link re-enters at once when the sign-in is still fresh.
  useEffect(() => { void enter(true); }, [enter]);
  useEffect(() => {
    const moved = () => setLocation(parseAdmin(window.location.pathname, window.location.search));
    window.addEventListener('popstate', moved);
    return () => window.removeEventListener('popstate', moved);
  }, []);
  // The change window ends by itself; the bar counts down and returns to view mode.
  const [, tick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => tick((n) => n + 1), 15_000); return () => window.clearInterval(timer); }, []);
  const viewing = changesUntil === null || changesUntil <= Date.now() / 1000;

  const toast = useCallback((next: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...next, id }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), next.undo ? 10_000 : 6_000);
  }, []);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOverlay('palette'); }
      else if (event.key === '?' && !typing) { event.preventDefault(); setOverlay('help'); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);

  if (!api || !me) {
    const fresh = error?.code === 'fresh_sign_in_required';
    return (
      <main className="admin-enter">
        <p className="cloud-eyebrow">SelectaDJ staff console</p>
        <h1>Enter the staff console</h1>
        {email && <p>Signed in as <strong>{email}</strong>, a staff account.</p>}
        <p>Your roles show when you enter. An admin session lasts at most an hour from now and needs a sign-in from the last five minutes; the console then opens in view mode.</p>
        <div className="cloud-actions">
          {fresh && onSignInAgain
            ? <button className="primary" onClick={onSignInAgain}>Sign in again</button>
            : <button className="primary" onClick={() => void enter()} disabled={busy}>{busy ? 'Entering…' : 'Enter console'}</button>}
          <button onClick={onLeave}>Back to my workspace</button>
        </div>
        {error && <p className="admin-error" role="alert">{error.message}</p>}
      </main>
    );
  }

  const can = (permission: string) => me.permissions.includes(permission);
  const visible = PAGES.filter((p) => can(p.needs) && (!p.flag || features?.[p.flag] !== false));
  const current = visible.find((p) => p.id === location.page) ?? visible[0];
  const environment = me.environment ?? 'development';
  const savePref = (key: string, value: unknown) => { void api(`/admin/me/preferences/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }).catch(() => undefined); };
  const makeChanges = async () => {
    try { const opened = await api<{ changes_until: number }>('/admin/session/changes', { method: 'POST' }); setChangesUntil(opened.changes_until); }
    catch (problem) { toast({ text: (problem as Error).message, tone: 'bad' }); }
  };
  const stopChanges = async () => { await api('/admin/session/changes', { method: 'DELETE' }).catch(() => undefined); setChangesUntil(null); };
  const ctx = {
    api, me, can, changesUntil: viewing ? null : changesUntil, makeChanges, stopChanges,
    needs: (p: string) => needsWords(me, p), spec: (id: string) => me.actions?.find((a) => a.id === id),
    toast, ask: setDanger,
  };
  const minutesLeft = changesUntil ? Math.max(0, Math.round((changesUntil - Date.now() / 1000) / 60)) : 0;
  const sessionLeft = Math.max(0, Math.round((me.session.expires_at - Date.now() / 1000) / 60));
  const playbook = location.query.get('playbook');

  return (
    <ConsoleContext.Provider value={ctx}>
      <div className={`admin-shell env-${environment}`}>
        <div className="admin-env" role="note">{ENV_NAMES[environment] ?? environment} · {me.email ?? me.user_id} · {me.roles.map((r) => r.title).join(', ')} · session ends in {sessionLeft} min</div>
        <nav className="admin-nav" aria-label="Console pages">
          <p className="admin-brand">SelectaDJ staff</p>
          {visible.map((p) => <a key={p.id} href={adminPath(p.id)} aria-current={current?.id === p.id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); go(adminPath(p.id)); }}>{p.label}</a>)}
          <button type="button" className="admin-leave" onClick={onLeave}>Leave console</button>
        </nav>
        <div className="admin-body">
          <header className="admin-top">
            <div>
              <p className="admin-crumbs"><a href={adminPath('overview')} onClick={(event) => { event.preventDefault(); go(adminPath('overview')); }}>Console</a>{current && <> / {current.label}</>}{location.rest[0] && <> / {decodeURIComponent(location.rest[0]).slice(0, 24)}</>}</p>
              <h1>{current?.label ?? 'Nothing to show'}</h1>
            </div>
            <div className="admin-top-tools">
              <form role="search" data-tour="search" onSubmit={(event) => { event.preventDefault(); setOverlay('palette'); }}>
                <button type="submit" className="admin-search">Search or jump <kbd>Ctrl K</kbd></button>
              </form>
              <Bell api={api} />
              <button type="button" aria-label="Help for this page" onClick={() => setOverlay('help')}>?</button>
              <button type="button" className="quiet" onClick={onLeave}>Back to my workspace</button>
            </div>
          </header>
          <div className={`admin-mode ${viewing ? 'viewing' : 'changing'}`} data-tour="mode" role="status">
            {viewing ? <span>Viewing. Nothing you do here changes anything.</span> : <span>Making changes, {minutesLeft} min left (renewed by each change).</span>}
            {me.can_write && (viewing
              ? <button type="button" onClick={() => void makeChanges()}>Make changes</button>
              : <button type="button" onClick={() => void stopChanges()}>Stop making changes</button>)}
          </div>
          {environment === 'production' && <ProductionNotice />}
          <main className="admin-main">
            {welcome && <Welcome me={me} onTour={() => { setWelcome(false); savePref('welcome', { done: true, at: Date.now() / 1000 }); setOverlay('tour'); }} onSkip={() => { setWelcome(false); savePref('welcome', { skipped: true, at: Date.now() / 1000 }); }} />}
            {!current && <p>Your roles don’t include any console page.</p>}
            {current?.id === 'overview' && <OverviewPage />}
            {current?.id === 'customers' && <CustomersPage route={location} />}
            {current?.id === 'billing' && <BillingPage route={location} />}
            {current?.id === 'jobs' && <JobsPage api={api} can={can} />}
            {current?.id === 'workers' && <WorkersPage />}
            {current?.id === 'ai' && <AiPage api={api} can={can} />}
            {current?.id === 'flags' && <FlagsPage api={api} can={can} />}
            {current?.id === 'content' && <ContentPage />}
            {current?.id === 'covers' && <CoversPage route={location} />}
            {current?.id === 'emergency' && <EmergencyPage />}
            {current?.id === 'security' && <StaffPage route={location} />}
            {current?.id === 'communications' && <CommsPage />}
            {current?.id === 'system' && <SystemPage />}
            {current?.id === 'pilots' && <PilotsPage api={api} />}
          </main>
        </div>
        {overlay === 'help' && current && <HelpPanel page={current.id} onClose={() => setOverlay(null)} onTour={() => setOverlay('tour')} onWelcome={() => { setOverlay(null); setWelcome(true); }} />}
        {playbook && <PlaybookView id={playbook} onClose={() => go(adminPath(current?.id ?? 'overview', location.rest))} />}
        {overlay === 'tour' && current && <Tour page={current.id} can={can} onDone={(finished) => { setOverlay(null); savePref('tours', { ...(me.preferences?.tours as Record<string, unknown> ?? {}), [current.id]: finished ? 'done' : 'ended' }); }} />}
        {overlay === 'palette' && <Palette api={api} pages={visible} onLeave={onLeave} onClose={() => setOverlay(null)} onPlaybook={(id) => go(adminPath(current?.id ?? 'overview', location.rest, { playbook: id }))} />}
        {danger && <DangerDialog request={danger} environment={environment} onClose={() => setDanger(null)} />}
        <Toasts toasts={toasts} dismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} />
      </div>
    </ConsoleContext.Provider>
  );
}

function ProductionNotice() {
  const [shown, setShown] = useState(() => { try { return sessionStorage.getItem('selecta.admin.prodNotice') !== '1'; } catch { return true; } });
  if (!shown) return null;
  return <p className="admin-prod-notice" role="note">You are in production: changes here reach real customers. <button type="button" className="quiet" onClick={() => { try { sessionStorage.setItem('selecta.admin.prodNotice', '1'); } catch { /* fine */ } setShown(false); }}>Understood</button></p>;
}

type BellItem = { id: string; text: string; link: string; at: number };

/** Unacknowledged alerts and waiting dangerous actions, each linking to its place. */
function Bell({ api }: { api: ReturnType<typeof adminFetch> }) {
  const [items, setItems] = useState<BellItem[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const [alerts, actions] = await Promise.all([
        api<{ alerts: { id: string; summary: string; created_at: number; acknowledged_at: number | null }[] }>('/admin/alerts?limit=20').catch(() => ({ alerts: [] })),
        api<{ actions: { id: string; description: string; execute_after: number }[] }>('/admin/actions').catch(() => ({ actions: [] })),
      ]);
      if (!live) return;
      setItems([
        ...actions.actions.map((a) => ({ id: a.id, text: `Waiting: ${a.description} (runs ${when(a.execute_after)})`, link: adminPath('security', ['actions']), at: a.execute_after })),
        ...alerts.alerts.filter((a) => !a.acknowledged_at).map((a) => ({ id: a.id, text: a.summary, link: adminPath('security', ['alerts']), at: a.created_at })),
      ]);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [api]);
  return (
    <div className="admin-bell">
      <button type="button" aria-expanded={open} aria-label={`Alerts, ${items.length} waiting`} onClick={() => setOpen(!open)}>Alerts {items.length > 0 && <span className="admin-badge warn">{items.length}</span>}</button>
      {open && <ul className="admin-bell-list">{items.length ? items.slice(0, 10).map((item) => <li key={item.id}><a href={item.link} onClick={(event) => { event.preventDefault(); setOpen(false); go(item.link); }}>{item.text}</a></li>) : <li className="admin-soft">Nothing needs you. Alerts and waiting actions appear here.</li>}</ul>}
    </div>
  );
}
