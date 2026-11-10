import { useAuth } from '@workos-inc/authkit-react';
import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { DevicesPanel } from '../devices/DevicesPanel';
import { CloudListen } from '../rooms/CloudListen';
import { LucyCloudSettings } from '../views/LucyCloudSettings';
import { AccountData } from './AccountData';
import { Account, apiOrigin, CloudError, featureOn, idempotencyKey, isOverQuota, lockedTo, messageOf, Page, pageShown, planName } from './api';
import { BLOCKED_MESSAGES, BlockedCode, blockedCode, refusalMessage, SUSPENDED_NOTICE } from './authConfig';
import { Billing } from './Billing';
import { checkoutBody, Consent, consentVersionFor, useCheckoutReturn } from './checkout';
import { CloudEvent, useCloudEvents } from './events';
import { LibraryPanel } from './Library';
import { StorageMeter } from './Meters';
import { blockedByQuota, OverQuotaBanner } from './OverQuota';
import { UploadsPanel } from './Uploads';
import './cloud.css';

// The staff console is its own bundle, loaded only when a staff member opens it.
const AdminArea = lazy(() => import('../admin/AdminArea'));

/** Whether this account may see the staff console link: staff, with the console flag on. */
export function showsAdmin(account: Account | null) {
  return Boolean(account?.user.staff) && account?.features['admin.console'] !== false;
}

export function pageFor(pathname: string): Page {
  if (pathname.includes('/account/billing')) return 'billing';
  if (pathname.includes('/account')) return 'settings';
  if (pathname.includes('/listen')) return 'listen';
  if (pathname.includes('/library')) return 'library';
  if (pathname.includes('/upload')) return 'uploads';
  return 'home';
}

const PATHS: Record<Page, string> ={ home: '/', listen: '/listen', library: '/library', uploads: '/upload', billing: '/account/billing', settings: '/account' };
const LABELS: Record<Page, string> = { home: 'Overview', listen: 'Listen', library: 'Library', uploads: 'Add music', billing: 'Plan & billing', settings: 'Settings' };
const TITLES: Record<Page, string> = { home: 'Your music workspace', listen: 'Listen', library: 'Your library', uploads: 'Add music', billing: 'Plan & billing', settings: 'Account settings' };

export function CloudApp() {
  const { isLoading, user, getAccessToken, signIn, signUp, signOut } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [blocked, setBlocked] = useState<BlockedCode | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [page, setPage] = useState<Page>(() => pageFor(window.location.pathname));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [inAdmin, setInAdmin] = useState(() => window.location.pathname.startsWith('/admin'));

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> => {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (workspaceId) headers.set('X-Workspace-ID', workspaceId);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${apiOrigin}/api${path}`, { ...init, headers });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : undefined;
      const code = detail && typeof detail === 'object' && 'code' in detail ? String((detail as { code: unknown }).code) : undefined;
      // An account-level refusal replaces the whole app with a plain explanation.
      const accountState = blockedCode(code);
      if (accountState) setBlocked(accountState);
      throw new CloudError(refusalMessage(code) ?? messageOf(payload, `Request failed (${response.status}).`), response.status, code);
    }
    return payload as T;
  }, [getAccessToken]);

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    try {
      const next = await api<Account>('/account');
      setAccount(next);
      setNeedsOnboarding(false);
    } catch (problem) {
      if (problem instanceof CloudError && problem.status === 409 && problem.code === 'not_onboarded') {
        setNeedsOnboarding(true);
        setAccount(null);
      } else {
        setError((problem as Error).message);
      }
    }
  }, [api, user]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  // After sign-in, AuthKit's redirect callback moves to the page the person started from.
  useEffect(() => {
    const follow = () => setPage(pageFor(window.location.pathname));
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  // Pages stay correct from the event stream, or from polling while it's blocked.
  const onEvent = useCallback((event: CloudEvent) => {
    // `flags.changed`: the rules moved, so this account's decisions may have; the page closes up
    // around anything now off (ADR-0414), or opens up around anything back on.
    if (event.topic.startsWith('entitlement.') || event.topic.startsWith('quota.') || event.topic.startsWith('account.') || event.topic.startsWith('flags.')) void refreshAccount();
    if (event.topic.startsWith('upload.') || event.topic.startsWith('asset.')) { void refreshAccount(); setLibraryVersion((value) => value + 1); }
  }, [refreshAccount]);
  const refreshAll = useCallback(async () => { await refreshAccount(); }, [refreshAccount]);
  const stream = useCloudEvents({ token: getAccessToken, workspaceId: account?.workspace.id ?? null, onEvent, refresh: refreshAll });

  const checkout = useCheckoutReturn(account, refreshAccount);
  const consentVersion = consentVersionFor(account);

  const startSignIn = () => void signIn({ state: { returnTo: `${window.location.pathname}${window.location.search}` } });

  const completeOnboarding = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await api('/onboarding/complete', { method: 'POST', body: JSON.stringify({ age_confirmed: ageConfirmed, timezone }) });
      await refreshAccount();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const openCheckout = async (plan: 'standard' | 'premium', interval: 'month' | 'year', consent: Consent) => {
    if (!account) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>('/billing/checkout', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify(checkoutBody(plan, interval, consent, consentVersion)),
      }, account.workspace.id);
      window.location.assign(result.url);
    } catch (problem) {
      setError(problem instanceof CloudError && problem.code === 'consent_version_changed'
        ? 'The subscription terms have just been updated. Refresh the page to read the new wording, then try again.'
        : (problem as Error).message);
    } finally { setBusy(false); }
  };

  const openPortal = async () => {
    if (!account) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>('/billing/portal', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ return_url: `${window.location.origin}/account/billing` }),
      }, account.workspace.id);
      window.location.assign(result.url);
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const signOutEverywhere = async () => {
    if (!account) return;
    setBusy(true); setError('');
    try {
      await api('/account/sign-out-everywhere', { method: 'POST' }, account.workspace.id);
      signOut({ returnTo: window.location.origin });
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const deleteAccount = async () => {
    const confirmed = window.confirm('Delete your Selecta Cloud account? Your account will be hidden and you will be signed out immediately. Final erasure is scheduled after the 30-day recovery window.');
    if (!confirmed) return;
    setBusy(true); setError('');
    try {
      await api('/account', { method: 'DELETE' }, account?.workspace.id);
      signOut({ returnTo: window.location.origin });
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const choosePage = (next: Page) => {
    setPage(next); setNotice(''); setError('');
    if (window.location.pathname !== PATHS[next]) window.history.pushState({}, '', PATHS[next]);
  };
  const lucyRequest = useCallback(<T,>(path: string, init?: RequestInit) => api<T>(path, init, account?.workspace.id), [api, account?.workspace.id]);

  if (isLoading) return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><p>Checking your sign-in…</p></main>;
  if (!user) return <main className="cloud-welcome"><span className="cloud-mark">S</span><p className="cloud-eyebrow">SELECTA CLOUD</p><h1>Your music, ready to move.</h1><p>Build your library, shape the set and keep the transitions ready on every device.</p><div className="cloud-actions"><button className="primary" onClick={() => void signUp()}>Create your account</button><button onClick={startSignIn}>Sign in</button></div><small>Your music stays private to your workspace.</small></main>;
  if (blocked) return <BlockedAccount code={blocked} onSignOut={() => signOut({ returnTo: window.location.origin })} />;
  if (!user.emailVerified) return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><h1>Verify your email</h1><p>Open the verification email for {user.email}, then refresh this page.</p><button onClick={() => window.location.reload()}>I’ve verified my email</button><button onClick={() => signOut({ returnTo: window.location.origin })}>Sign out</button></main>;
  if (needsOnboarding) return <main className="cloud-onboarding"><span className="cloud-mark">S</span><p className="cloud-eyebrow">ONE QUICK CHECK</p><h1>Set up your Selecta workspace</h1><p>Your personal space starts with 10 GB of private music storage.</p><form onSubmit={(event) => void completeOnboarding(event)}><label className="cloud-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm that I’m at least 13 years old.</label><button className="primary" disabled={!ageConfirmed || busy}>Create workspace</button></form><Feedback error={error} notice="" /></main>;

  if (inAdmin && showsAdmin(account)) {
    const leave = () => { setInAdmin(false); window.history.pushState({}, '', '/'); setPage('home'); };
    return <Suspense fallback={<main className="cloud-runtime-message"><p>Opening the staff console…</p></main>}><AdminArea token={getAccessToken} onLeave={leave} origin={apiOrigin} /></Suspense>;
  }

  const quotaBlock = blockedByQuota(account);
  // A page whose feature is off isn't there: its address shows the overview instead.
  const shown: Page = pageShown(account, page) ? page : 'home';
  return (
    <div className="cloud-shell" data-stream={stream}>
      <aside className="cloud-rail">
        <button className="cloud-brand" aria-label="Selecta Cloud home" onClick={() => choosePage('home')}><span className="cloud-mark">S</span><span>Selecta<span className="cloud-brand-sub">CLOUD</span></span></button>
        <nav aria-label="Cloud workspace">
          {(Object.keys(LABELS) as Page[]).filter((target) => pageShown(account, target)).map((target) => (
            <button key={target} aria-current={shown === target ? 'page' : undefined} onClick={() => choosePage(target)}>{LABELS[target]}</button>
          ))}
        </nav>
        <div className="cloud-rail-bottom">{showsAdmin(account) && <button onClick={() => { setInAdmin(true); window.history.pushState({}, '', '/admin'); }}>Staff console</button>}<span>{user.email}</span><button onClick={() => void signOutEverywhere()} disabled={busy}>Sign out everywhere</button><button className="cloud-delete-account" onClick={() => void deleteAccount()} disabled={busy}>Delete account</button></div>
      </aside>
      <main className="cloud-main">
        <header className="cloud-top"><div><p className="cloud-eyebrow">{account?.workspace.name ?? 'YOUR WORKSPACE'}</p><h1>{TITLES[shown]}</h1></div><span className="cloud-plan-chip">{account ? planName(account) : 'Free'} plan</span></header>
        {account?.user.suspended && <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>}
        <OverQuotaBanner account={account} go={choosePage} />
        {stream === 'polling' && <p className="cloud-stream-note" role="status">Live updates are paused on this network, so this page checks for changes every few seconds.</p>}
        <Feedback error={error} notice={notice} />
        {shown === 'home' && account && <Overview account={account} go={choosePage} />}
        {shown === 'listen' && account && <CloudListen api={api} account={account} />}
        {shown === 'library' && account && <LibraryPanel api={api} workspaceId={account.workspace.id} setError={setError} refreshAccount={refreshAccount} go={choosePage} reload={libraryVersion} />}
        {shown === 'uploads' && account && <UploadsPanel api={api} workspaceId={account.workspace.id} setError={setError} setNotice={setNotice} blocked={quotaBlock} onAccepted={() => void refreshAccount()} />}
        {shown === 'billing' && account && <Billing account={account} busy={busy} phase={checkout} consentVersion={consentVersion} blocked={isOverQuota(account)} onCheckout={(plan, interval, consent) => void openCheckout(plan, interval, consent)} onPortal={() => void openPortal()} />}
        {shown === 'settings' && account && <div className="cloud-settings"><AccountData token={getAccessToken} workspaceId={account.workspace.id} features={account.features} />{featureOn(account, 'devices') && <DevicesPanel api={api} workspaceId={account.workspace.id} />}{featureOn(account, 'lucy') && featureOn(account, 'account.lucy_settings') && <LucyCloudSettings request={lucyRequest} features={account.features} />}</div>}
        <footer className="cloud-footer">Selecta Cloud · Your originals remain private to your workspace.</footer>
      </main>
    </div>
  );
}

function BlockedAccount({ code, onSignOut }: { code: BlockedCode; onSignOut: () => void }) {
  const message = BLOCKED_MESSAGES[code];
  return <main className="cloud-runtime-message" role="alert"><span className="cloud-mark">S</span><h1>{message.title}</h1><p>{message.detail}</p>
    {code === 'verified_email_required' && <button onClick={() => window.location.reload()}>I’ve verified my email</button>}
    <button onClick={onSignOut}>{code === 'session_revoked' || code === 'token_invalid' || code === 'token_expired' ? 'Sign in again' : 'Sign out'}</button>
  </main>;
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (!error && !notice) return null;
  return <div className={error ? 'cloud-feedback error' : 'cloud-feedback'} role={error ? 'alert' : 'status'}>{error || notice}</div>;
}

function Overview({ account, go }: { account: Account; go: (page: Page) => void }) {
  const uploads = featureOn(account, 'cloud.uploads');
  return <>
    {uploads && <section className="cloud-hero"><div><p className="cloud-eyebrow">MADE FOR YOUR NEXT SET</p><h2>Your library starts here.</h2><p>Add your tracks and Selecta will prepare them for your next mix.</p><button className="primary" onClick={() => go('uploads')}>Add music</button></div><div className="cloud-hero-art" aria-hidden="true"><span>♪</span><i /><b /><em /></div></section>}
    <div className="cloud-cards"><StorageMeter account={account} /><section className="cloud-card"><p className="cloud-eyebrow">CURRENT PLAN</p><h2>{planName(account)}</h2><p>Storage and processing limits are managed with your plan.</p><button onClick={() => go('billing')}>Manage plan</button></section>{uploads && <section className="cloud-card"><p className="cloud-eyebrow">YOUR MUSIC</p><h2>Library and uploads</h2><p>Browse private files or add tracks to your workspace.</p><button onClick={() => go('library')}>Open library</button><button onClick={() => go('uploads')}>Upload tracks</button></section>}</div>
    <RoomsCard account={account} go={go} />
  </>;
}

/** Rooms on the overview: an invitation when the account has Rooms, a locked teaser naming the
 * plan when only a plan unlocks it, and nothing at all when it's switched off. */
function RoomsCard({ account, go }: { account: Account; go: (page: Page) => void }) {
  const plan = lockedTo(account, 'rooms');
  if (plan) {
    const name = `${plan[0]?.toUpperCase() ?? ''}${plan.slice(1)}`;
    return <section className="cloud-card cloud-locked"><div><p className="cloud-eyebrow">{name.toUpperCase()} FEATURE</p><h2>Host a request room</h2><p>Share a QR code so guests can add requests to your set. Rooms are part of {name}.</p></div><button onClick={() => go('billing')}>Explore {name}</button></section>;
  }
  if (!featureOn(account, 'rooms')) return null;
  return <section className="cloud-card cloud-locked"><div><p className="cloud-eyebrow">ROOMS</p><h2>Host a request room</h2><p>Share a QR code so guests can add requests to your set.</p></div><button onClick={() => go('listen')}>Open a room</button></section>;
}
