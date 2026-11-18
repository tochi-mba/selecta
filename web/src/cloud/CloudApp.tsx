import { useAuth } from '@workos-inc/authkit-react';
import { FormEvent, lazy, ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { VenueSetup } from '../autopilot/VenueSetup';
import { DevicesPanel } from '../devices/DevicesPanel';
import { DeviceCheck, showsDeviceCheck } from '../devices/DeviceCheck';
import { PLAYBACK_COMMAND_EVENT } from '../devices/usePlaybackDevice';
import { CloudListen } from '../rooms/CloudListen';
import { RoomPanel } from '../rooms/RoomPanel';
import { LucyCloudSettings } from '../views/LucyCloudSettings';
import { accountFlagOn, flagOn, setAccountFeatures, useFlags } from '../flags';
import { DESTINATIONS, type MoreDestinationId } from '../shell/manifest';
import { AccountDanger, AccountData } from './AccountData';
import { AccountProblem, accountProblem, blockedMessage } from './accountStates';
import { Account, apiOrigin, CloudError, idempotencyKey, isOverQuota, lockedTo, messageOf, Page, pageShown, planName } from './api';
import { BlockedCode, blockedCode, callbackProblem, refusalMessage, SUSPENDED_NOTICE, withoutCallbackError } from './authConfig';
import { Billing } from './Billing';
import { PrivacyNoticeDraft, showsPrivacyDraft } from './PrivacyNoticeDraft';
import { checkoutBody, Consent, consentVersionFor, useCheckoutReturn } from './checkout';
import { CloudTransportDock, singleAudioOwner } from './CloudTransportDock';
import { ACCOUNT_STATES_FLAG, resolveRoute } from './cloudRoutes';
import { AccountProblemNote, AccountProblemPage, NotFound, SuspendedPanel } from './CloudStates';
import { CloudEvent, useCloudEvents } from './events';
import { LIBRARY_STATES_FLAG } from './libraryState';
import { LibraryPanel } from './Library';
import { MakeCloudMix } from './MakeCloudMix';
import { StorageMeter } from './Meters';
import { blockedByQuota, OverQuotaBanner } from './OverQuota';
import { UploadsPanel } from './Uploads';
import { isHostedAccount } from './localFirstGate';
import { LocalFirstLabs } from './labs/LocalFirstLabs';
import { ReconciliationPanel } from './migration/ReconciliationPanel';
import { navigate, useLocationText } from '../router';
import { Action, LiveRegion, Section } from '../ui/controls';
import { Toaster } from '../ui/toasts';
import { BrandMark } from '../ui/BrandMark';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { HostedView } from './HostedShell';
import './cloud.css';
// Shared business styles are scoped to .biz and loaded by the Cloud shell.
import '../business/business.css';

// The staff console is its own bundle, loaded only when a staff member opens it.
const AdminArea = lazy(() => import('../admin/AdminArea'));
// The local-first shell (ADR-0462/0463) and the browser engine it carries load only for an account
// that has the local-first experience with `cloud.local_first` on; everyone else never fetches it.
const LocalFirstShell = lazy(() => import('./LocalFirstShell').then((module) => ({ default: module.LocalFirstShell })));
// The venue tablet posture flow (ADR-0460) carries the browser engine too, so it loads only with
// `cloud.venue_tablet` on.
const VenuePosture = lazy(() => import('./venue/VenuePosture').then((module) => ({ default: module.VenuePosture })));
// The hosted pages on the shared shell (`cloud.hosted_shell`): the shell loads only with the flag
// on, so the legacy rail's bundle is unchanged with it off. It carries no engine.
const HostedShell = lazy(() => import('./HostedShell').then((module) => ({ default: module.HostedShell })));

/** The work a button starts. Each has its own busy state, so a slow checkout never greys out
 * Sign out everywhere, and the button pressed is the one that says it is working. */
type Operation = 'onboarding' | 'checkout' | 'portal' | 'everywhere' | 'delete';

/** Whether this account gets the local-first shell: `showsLocalFirst`, decided on the account's own
 * read. The hosted shell reads `cloud.local_first` as off while it is open (it is not the
 * local-first shell), which must not keep a member who has just joined Labs out of it. */
function localFirstDecided(account: Account | null): boolean {
  return account?.experience?.local_first === true && accountFlagOn('cloud.local_first', account.features);
}

/** Whether this account may see the staff console link: staff, with the console flag on. */
export function showsAdmin(account: Account | null) {
  return Boolean(account?.user.staff) && accountFlagOn('admin.console', account?.features ?? null);
}

/** The first, substring matching of addresses (`/listening` opened Listen). Kept for
 * `cloud.account_states` off; with it on, cloudRoutes.ts matches addresses exactly. */
export function pageFor(pathname: string): Page {
  if (pathname.includes('/account/billing')) return 'billing';
  if (pathname.includes('/account')) return 'settings';
  if (pathname.includes('/listen')) return 'listen';
  if (pathname.includes('/library')) return 'library';
  if (pathname.includes('/upload')) return 'uploads';
  return 'home';
}

const PATHS: Record<Page, string> ={ home: '/', listen: '/listen', library: '/library', uploads: '/upload', billing: '/account/billing', settings: '/account' };
const sharedLabel = (id: 'listen' | 'library') => DESTINATIONS.find((destination) => destination.id === id)!.label;
const LABELS: Record<Page, string> = { home: 'Overview', listen: sharedLabel('listen'), library: sharedLabel('library'), uploads: 'Add music', billing: 'Plan & billing', settings: 'Settings' };
/** The page the hosted dock is beside in the shared shell: Make a Mix was part of Listen, and the
 * account places are the account's pages. */
function dockPage(view: HostedView): Page {
  if (typeof view !== 'object') return view === 'mixes' ? 'listen' : view;
  if ('missing' in view) return 'home';
  return view.more === 'uploads' ? 'uploads' : view.more === 'billing' ? 'billing' : 'settings';
}
const TITLES: Record<Page, string> = { home: 'Your music workspace', listen: 'Listen', library: 'Your library', uploads: 'Add music', billing: 'Plan & billing', settings: 'Account settings' };

export function CloudApp() {
  const { isLoading, user, getAccessToken, signIn, signUp, signOut } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [blocked, setBlocked] = useState<BlockedCode | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [page, setPage] = useState<Page>(() => pageFor(window.location.pathname));
  const [running, setRunning] = useState<ReadonlySet<Operation>>(() => new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [inAdmin, setInAdmin] = useState(() => window.location.pathname.startsWith('/admin'));
  // Exact routes (`cloud.account_states`): the address itself is the state, read on every move.
  const [path, setPath] = useState(() => window.location.pathname);
  const [problem, setProblem] = useState<{ kind: AccountProblem; message: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const moved = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // AuthKit sent the person back without signing them in: say why, then clean the address.
  const [signInProblem] = useState(() => callbackProblem(window.location.search));
  useEffect(() => {
    if (signInProblem) window.history.replaceState({}, '', withoutCallbackError(window.location.pathname, window.location.search, window.location.hash));
  }, [signInProblem]);

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
      throw new CloudError(refusalMessage(code) ?? messageOf(payload, `Request failed (${response.status}).`), response.status, code, payload);
    }
    return payload as T;
  }, [getAccessToken]);

  // One operation at a time per button: its own busy state, and a refusal said in the page feedback.
  const operate = useCallback(async (operation: Operation, work: () => Promise<void>) => {
    setRunning((now) => new Set(now).add(operation));
    setError('');
    try { await work(); } catch (problem) { setError((problem as Error).message); }
    finally { setRunning((now) => { const next = new Set(now); next.delete(operation); return next; }); }
  }, []);
  const busy = (operation: Operation) => running.has(operation);

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    try {
      const next = await api<Account>('/account');
      // ADR-0462 one flag read: every account load and refresh feeds flagOn before the redraw.
      setAccountFeatures(next.features);
      setAccount(next);
      setNeedsOnboarding(false);
      setProblem(null);
    } catch (problem) {
      if (problem instanceof CloudError && problem.status === 409 && problem.code === 'not_onboarded') {
        setNeedsOnboarding(true);
        setAccountFeatures(null);
        setAccount(null);
      } else {
        setError((problem as Error).message);
        setProblem({ kind: accountProblem(problem), message: (problem as Error).message });
      }
    }
  }, [api, user]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);
  // The account's features leave with the app, so nothing after it gates on a stale account.
  useEffect(() => () => setAccountFeatures(null), []);
  useFlags();

  // After sign-in, AuthKit's redirect callback moves to the page the person started from.
  useEffect(() => {
    const follow = () => { setPage(pageFor(window.location.pathname)); setPath(window.location.pathname); };
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  // Pages stay correct from the event stream, or from polling while it's blocked.
  const onEvent = useCallback((event: CloudEvent) => {
    // `flags.changed`: the rules moved, so this account's decisions may have; the page closes up
    // around anything now off (ADR-0414), or opens up around anything back on.
    // `session.revoked`: the server ended this stream because the sign-in was revoked; asking
    // for the account hears `session_revoked` and shows "You were signed out" (SC-0400-08).
    if (event.topic.startsWith('entitlement.') || event.topic.startsWith('quota.') || event.topic.startsWith('account.') || event.topic.startsWith('flags.') || event.topic.startsWith('session.')) void refreshAccount();
    // ADR-0461: commands reach the speaker hook (usePlaybackDevice), which checks and acks them.
    if (event.topic === 'playback.command') window.dispatchEvent(new CustomEvent(PLAYBACK_COMMAND_EVENT, { detail: event.payload }));
    if (event.topic.startsWith('upload.') || event.topic.startsWith('asset.')) { void refreshAccount(); setLibraryVersion((value) => value + 1); }
  }, [refreshAccount]);
  const refreshAll = useCallback(async () => { await refreshAccount(); }, [refreshAccount]);
  const stream = useCloudEvents({ token: getAccessToken, workspaceId: account?.workspace.id ?? null, onEvent, refresh: refreshAll });

  const checkout = useCheckoutReturn(account, refreshAccount);
  const consentVersion = consentVersionFor(account);

  const startSignIn = () => void signIn({ state: { returnTo: `${window.location.pathname}${window.location.search}` } });

  const completeOnboarding = async (event: FormEvent) => {
    event.preventDefault();
    await operate('onboarding', async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await api('/onboarding/complete', { method: 'POST', body: JSON.stringify({ age_confirmed: ageConfirmed, timezone }) });
      await refreshAccount();
    });
  };

  const openCheckout = async (plan: 'standard' | 'premium', interval: 'month' | 'year', consent: Consent) => {
    if (!account) return;
    await operate('checkout', async () => {
      try {
        const result = await api<{ url: string }>('/billing/checkout', {
          method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
          body: JSON.stringify(checkoutBody(plan, interval, consent, consentVersion)),
        }, account.workspace.id);
        window.location.assign(result.url);
      } catch (problem) {
        throw problem instanceof CloudError && problem.code === 'consent_version_changed'
          ? new Error('The subscription terms have just been updated. Refresh the page to read the new wording, then try again.')
          : problem;
      }
    });
  };

  const openPortal = async () => {
    if (!account) return;
    await operate('portal', async () => {
      const result = await api<{ url: string }>('/billing/portal', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ return_url: `${window.location.origin}/account/billing` }),
      }, account.workspace.id);
      window.location.assign(result.url);
    });
  };

  const signOutEverywhere = async () => {
    if (!account) return;
    await operate('everywhere', async () => {
      await api('/account/sign-out-everywhere', { method: 'POST' }, account.workspace.id);
      signOut({ returnTo: window.location.origin });
    });
  };

  // Asked first, on the shared overlay stack: the rail's Delete account opens the dialog, and the
  // Account page's own confirmation (AccountDanger) calls deleteAccount once it has been answered.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteAccount = async () => {
    await operate('delete', async () => {
      await api('/account', { method: 'DELETE' }, account?.workspace.id);
      signOut({ returnTo: window.location.origin });
    });
  };
  const deleteDialog = confirmingDelete && (
    <ConfirmDialog
      destructive
      title="Delete your SelectaDJ Cloud account?"
      body="It is hidden and you are signed out at once. Final erasure happens after the 30 day recovery window; contact SelectaDJ support within it to keep the account."
      confirmLabel="Delete my account"
      cancelLabel="Keep my account"
      working="Deleting…"
      onConfirm={async () => {
        // the dialog stays open and says why when the server refuses
        await api('/account', { method: 'DELETE' }, account?.workspace.id);
        signOut({ returnTo: window.location.origin });
      }}
      onClose={() => setConfirmingDelete(false)}
    />
  );

  const choosePage = (next: Page) => {
    setPage(next); setNotice(''); setError('');
    if (window.location.pathname !== PATHS[next]) window.history.pushState({}, '', PATHS[next]);
    setPath(PATHS[next]);
    moved.current = true;
    // a new page starts at its top, as the shared shells' pages do
    window.scrollTo?.(0, 0);
  };
  const exact = flagOn(ACCOUNT_STATES_FLAG);
  const route = resolveRoute(path);
  // With exact routes, an address whose page is switched off shows the overview and says so in
  // the address too, never a page that doesn't match it.
  const routedPage = route.kind === 'page' ? route.page : null;
  const localFirst = account !== null && localFirstDecided(account);
  // `cloud.hosted_shell`: every other account's pages in the shared shell, which routes them itself.
  // The server decides every registry flag in the account's snapshot; this one moves the whole
  // frame, so it is drawn only when decided on, never because an answer did not mention it.
  const hostedShell = account !== null && !localFirst && account.features['cloud.hosted_shell'] === true && flagOn('cloud.hosted_shell');
  // The shared shells move with the router, not choosePage, so a message about one page is not
  // left standing on the next.
  const place = useLocationText().split('?')[0];
  useEffect(() => {
    if (!hostedShell) return;
    setError(''); setNotice('');
  }, [hostedShell, place]);
  useEffect(() => {
    if (!exact || hostedShell || !account || !routedPage || pageShown(account, routedPage)) return;
    window.history.replaceState({}, '', `/${window.location.search}${window.location.hash}`);
    setPath('/');
  }, [exact, hostedShell, account, routedPage]);
  // Keyboard and screen reader users land on the new page's title after choosing a page, in one
  // line, as pageStart does in the shared shells (never the whole content read aloud).
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    titleRef.current?.focus({ preventScroll: true });
  }, [path, page]);
  // An unreachable account tries again by itself when the connection comes back.
  useEffect(() => {
    if (!exact || problem?.kind !== 'offline') return;
    const again = () => void refreshAccount();
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [exact, problem?.kind, refreshAccount]);
  const retryAccount = async () => { setRetrying(true); try { await refreshAccount(); } finally { setRetrying(false); } };
  const workspaceRequest = useCallback(<T,>(path: string, init?: RequestInit) => api<T>(path, init, account?.workspace.id), [api, account?.workspace.id]);

  if (isLoading) return <main className="cloud-runtime-message"><BrandMark className="cloud-mark" /><p>Checking your sign-in…</p></main>;
  if (!user) return <main className="cloud-welcome"><BrandMark className="cloud-mark" /><p className="cloud-eyebrow cloud-caps">SelectaDJ Cloud</p><h1>Your music, ready to move.</h1><p>Build your library, shape the set and keep the transitions ready on every device.</p>{signInProblem && <p className="cloud-feedback error" role="alert">{signInProblem}</p>}<div className="cloud-actions"><button className="primary" onClick={() => void signUp()}>Create your account</button><button onClick={startSignIn}>Sign in</button></div><small>Your music stays private to your workspace.</small><footer className="cloud-footer"><CloudCredit /></footer></main>;
  if (blocked) return <BlockedAccount code={blocked} distinct={exact} onSignOut={() => signOut({ returnTo: window.location.origin })} />;
  if (!user.emailVerified) return <main className="cloud-runtime-message"><BrandMark className="cloud-mark" /><h1>Verify your email</h1><p>Open the verification email for {user.email}, then refresh this page.</p><button onClick={() => window.location.reload()}>I’ve verified my email</button><button onClick={() => signOut({ returnTo: window.location.origin })}>Sign out</button></main>;
  if (needsOnboarding) return <main className="cloud-onboarding"><BrandMark className="cloud-mark" /><p className="cloud-eyebrow cloud-caps">One quick check</p><h1>Set up your SelectaDJ workspace</h1><p>Your personal space starts with 10 GB of private music storage.</p><form onSubmit={(event) => void completeOnboarding(event)}><label className="cloud-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm that I’m at least 13 years old.</label><button className="primary" disabled={!ageConfirmed || busy('onboarding')} aria-busy={busy('onboarding') || undefined}>Create workspace</button></form><Feedback error={error} notice="" /></main>;

  // No account could be read at all: say why, instead of an empty workspace (AV-0420-03).
  if (exact && !account && problem) return <AccountProblemPage kind={problem.kind} retrying={retrying} onRetry={() => void retryAccount()} onSignOut={() => signOut({ returnTo: window.location.origin })} />;

  if ((exact ? route.kind === 'admin' : inAdmin) && showsAdmin(account)) {
    const leave = () => { setInAdmin(false); window.history.pushState({}, '', '/'); setPage('home'); setPath('/'); };
    return <Suspense fallback={<main className="cloud-runtime-message"><p>Opening the staff console…</p></main>}><AdminArea token={getAccessToken} onLeave={leave} origin={apiOrigin} /></Suspense>;
  }

  const quotaBlock = blockedByQuota(account);
  const signOutHere = () => signOut({ returnTo: window.location.origin });
  const openAdmin = () => { setInAdmin(true); window.history.pushState({}, '', '/admin'); setPath('/admin'); };
  // Both shared shells have their own router: a hosted page moves to the same address there,
  // which they serve from More (Account, Plan & billing, Add music) or their own pages.
  const goShell = (next: Page) => navigate(PATHS[next]);
  // the shared shells have no rail, so the account page says who is signed in and offers leaving
  const framed = localFirst || hostedShell;
  const settingsPanel = account ? <div className="cloud-settings">{framed && <AccountStrip email={user.email} onSignOut={signOutHere} onStaffConsole={showsAdmin(account) ? openAdmin : undefined} />}{framed && lockedTo(account, 'rooms') && <RoomsCard account={account} go={goShell} />}{localFirst && isHostedAccount(account) && accountFlagOn('cloud.stored_media', account.features) && <ReconciliationPanel request={workspaceRequest} />}<AccountData token={getAccessToken} workspaceId={account.workspace.id} features={account.features} />{flagOn('devices') && <DevicesPanel api={api} workspaceId={account.workspace.id} />}{accountFlagOn('lucy', account.features) && accountFlagOn('account.lucy_settings', account.features) && <LucyCloudSettings request={workspaceRequest} features={account.features} />}{showsDeviceCheck(account.features) && <DeviceCheck />}{flagOn('cloud.venue_tablet') && <Suspense fallback={null}><VenuePosture workspaceId={account.workspace.id} places={{ localFirst, devices: flagOn('devices'), rooms: flagOn('rooms'), library: localFirst || pageShown(account, 'library') }} /></Suspense>}{(flagOn('cloud.local_first_labs') || account.experience?.local_first === true) && <LocalFirstLabs request={<T,>(path: string, init?: RequestInit) => api<T>(path, init, account.workspace.id)} onChanged={() => void refreshAccount()} />}{showsPrivacyDraft(account.features) && <PrivacyNoticeDraft />}{flagOn('autopilot.venue_mode') && flagOn('autopilot.venue_policy') && <VenueSetup api={api} workspaceId={account.workspace.id} />}{(exact || hostedShell) && <AccountDanger busy={busy('everywhere') || busy('delete')} onSignOutEverywhere={() => void signOutEverywhere()} onDelete={() => void deleteAccount()} />}</div> : null;
  const billing = account && <Billing account={account} busy={busy('checkout') || busy('portal')} phase={checkout} consentVersion={consentVersion} blocked={isOverQuota(account)} onCheckout={(plan, interval, consent) => void openCheckout(plan, interval, consent)} onPortal={() => void openPortal()} />;
  const uploads = account && <UploadsPanel api={api} workspaceId={account.workspace.id} setError={setError} setNotice={setNotice} blocked={quotaBlock} onAccepted={() => void refreshAccount()} perFile={flagOn(LIBRARY_STATES_FLAG)} />;
  // The account places behind More, one drawing for both shared shells.
  const morePanel = (id: MoreDestinationId): ReactNode => {
    if (!account) return null;
    switch (id) {
      case 'account': return settingsPanel;
      case 'billing': return billing;
      case 'devices': return <DevicesPanel api={api} workspaceId={account.workspace.id} />;
      case 'rooms': return <RoomPanel api={api} workspaceId={account.workspace.id} locked={account.feature_locks.rooms} votesOn={flagOn('rooms.votes')} displayOn={flagOn('rooms.display')} playHereOn={flagOn('devices')} freshOnly={account.features['rooms.nickname_confirm'] === true} />;
      case 'uploads': return uploads;
      case 'workspace': return null;
    }
  };
  // The hosted frame's account notices, in a shared shell's banner slot (one source for every frame).
  const shellNotices = account && <>
    {account.user.suspended && (exact ? <SuspendedPanel go={goShell} /> : <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>)}
    {problem && <AccountProblemNote kind={problem.kind} onRetry={() => void retryAccount()} />}
    <OverQuotaBanner account={account} go={goShell} />
    {stream === 'polling' && <p className="cloud-stream-note" role="status">Live updates are paused on this network, so this page checks for changes every few seconds.</p>}
  </>;
  const shellFeedback = <Feedback error={problem && error === problem.message ? '' : error} notice={notice} />;

  // ADR-0462/0463: an account with the local-first experience, and `cloud.local_first` on, gets the
  // shared shell. With either off, everything below renders exactly as before.
  if (account && localFirst) {
    return (
      <Suspense fallback={<main className="cloud-runtime-message"><BrandMark className="cloud-mark" /><p>Opening SelectaDJ…</p></main>}>
        <LocalFirstShell api={api} account={account} more={morePanel} notices={shellNotices} feedback={shellFeedback} />
      </Suspense>
    );
  }

  // `cloud.hosted_shell`: the same hosted pages, inside the shared shell. Off, the legacy rail below.
  if (account && hostedShell) {
    const hostedPage = (view: HostedView): ReactNode => {
      if (typeof view === 'object') return 'more' in view ? morePanel(view.more) : <NotFound path={view.missing} go={goShell} />;
      switch (view) {
        case 'home': return <><div className="cloud-top"><p className="cloud-eyebrow">{account.workspace.name}</p><span className="cloud-plan-chip">{planName(account)} plan</span></div><Overview account={account} go={goShell} /></>;
        case 'listen': return <CloudListen api={api} account={account} />;
        case 'mixes': return <MakeCloudMix api={api} account={account} />;
        case 'library': return <LibraryPanel api={api} workspaceId={account.workspace.id} setError={setError} refreshAccount={refreshAccount} go={goShell} reload={libraryVersion} truthful={flagOn(LIBRARY_STATES_FLAG)} account={account} />;
      }
    };
    return (
      <Suspense fallback={<main className="cloud-runtime-message"><BrandMark className="cloud-mark" /><p>Opening SelectaDJ…</p></main>}>
        <HostedShell
          account={account}
          page={hostedPage}
          notices={<>{shellNotices}{shellFeedback}</>}
          dock={singleAudioOwner(account) ? (view) => <CloudTransportDock api={api} account={account} page={dockPage(view)} reload={libraryVersion} /> : undefined}
          footer={<footer className="cloud-footer">SelectaDJ Cloud · Your originals remain private to your workspace.<CloudCredit /></footer>}
        />
        {deleteDialog}
      </Suspense>
    );
  }
  // A page whose feature is off isn't there: its address shows the overview instead.
  const wanted: Page = exact ? routedPage ?? 'home' : page;
  const shown: Page = pageShown(account, wanted) ? wanted : 'home';
  // An address no page answers (or the console, for anyone not staff) is said to be not found
  // once the account is known; before that the page simply waits for it.
  const notFound = exact && account !== null && (route.kind === 'not-found' || (route.kind === 'admin' && !showsAdmin(account)));
  const view: Page | null = notFound ? null : shown;
  return (
    <div className="cloud-shell" data-stream={stream}>
      <aside className="cloud-rail">
        <button className="cloud-brand" title="Return to Cloud home" onClick={() => choosePage('home')}><span className="cloud-mark" aria-hidden="true">S</span><span>SelectaDJ{' '}<span className="cloud-brand-sub">REX Technologies</span></span></button>
        <nav aria-label="Cloud workspace">
          {(Object.keys(LABELS) as Page[]).filter((target) => pageShown(account, target)).map((target) => (
            <button key={target} aria-current={view === target ? 'page' : undefined} onClick={() => choosePage(target)}>{LABELS[target]}</button>
          ))}
        </nav>
        <div className="cloud-rail-bottom">{showsAdmin(account) && <button onClick={openAdmin}>Staff console</button>}<span>{user.email}</span>{exact && <button onClick={signOutHere}>Sign out</button>}
          <Action run={signOutEverywhere} disabled={busy('everywhere')}>Sign out everywhere</Action>
          <button className="cloud-delete-account" onClick={() => setConfirmingDelete(true)} disabled={busy('delete')}>Delete account</button></div>
      </aside>
      <main className="cloud-main">
        <header className="cloud-top"><div><p className={account ? 'cloud-eyebrow' : 'cloud-eyebrow cloud-caps'}>{account?.workspace.name ?? 'Your workspace'}</p><h1 ref={titleRef} tabIndex={-1}>{notFound ? 'Page not found' : TITLES[shown]}</h1></div><span className="cloud-plan-chip">{account ? planName(account) : 'Free'} plan</span></header>
        {account?.user.suspended && (exact ? <SuspendedPanel go={choosePage} /> : <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>)}
        {exact && account && problem && <AccountProblemNote kind={problem.kind} onRetry={() => void retryAccount()} />}
        <OverQuotaBanner account={account} go={choosePage} />
        {stream === 'polling' && <p className="cloud-stream-note" role="status">Live updates are paused on this network, so this page checks for changes every few seconds.</p>}
        <Feedback error={exact && problem && error === problem.message ? '' : error} notice={notice} />
        {notFound && <NotFound path={path} go={choosePage} />}
        {account && singleAudioOwner(account) && <CloudTransportDock api={api} account={account} page={shown} reload={libraryVersion} />}
        {/* each page in its own Section: one that fails to draw says so, and the rail stays */}
        <Section key={view ?? 'not-found'} name={notFound ? 'This page' : TITLES[shown]}>
          {view === 'home' && account && <Overview account={account} go={choosePage} />}
          {view === 'listen' && account && <CloudListen api={api} account={account} />}
          {view === 'listen' && account && <MakeCloudMix api={api} account={account} />}
          {view === 'library' && account && <LibraryPanel api={api} workspaceId={account.workspace.id} setError={setError} refreshAccount={refreshAccount} go={choosePage} reload={libraryVersion} truthful={flagOn(LIBRARY_STATES_FLAG)} account={account} />}
          {view === 'uploads' && uploads}
          {view === 'billing' && billing}
          {view === 'settings' && settingsPanel}
        </Section>
        <footer className="cloud-footer">SelectaDJ Cloud · Your originals remain private to your workspace.<CloudCredit /></footer>
      </main>
      <Toaster />
      <LiveRegion />
      {deleteDialog}
    </div>
  );
}

/** Who is signed in, for the local-first shell's Account panel (the hosted frame shows it in its rail). */
export function AccountStrip({ email, onSignOut, onStaffConsole }: { email: string; onSignOut: () => void; onStaffConsole?: () => void }) {
  return (
    <section className="cloud-card cloud-account-strip" aria-label="Signed in as">
      <p className="cloud-eyebrow cloud-caps">Signed in as</p>
      <p className="cloud-account-email">{email}</p>
      <div className="cloud-actions">
        <button className="quiet" onClick={onSignOut}>Sign out</button>
        {onStaffConsole && <button onClick={onStaffConsole}>Staff console</button>}
      </div>
    </section>
  );
}

/** Who makes SelectaDJ, shown once at the foot of Cloud pages. */
export function CloudCredit() {
  return <span className="cloud-credit">SelectaDJ is a REX Technologies product. © {new Date().getFullYear()} REX Technologies</span>;
}

function BlockedAccount({ code, distinct, onSignOut }: { code: BlockedCode; distinct: boolean; onSignOut: () => void }) {
  const message = blockedMessage(code, distinct);
  return <main className="cloud-runtime-message" role="alert"><BrandMark className="cloud-mark" /><h1>{message.title}</h1><p>{message.detail}</p>
    {code === 'verified_email_required' && <button onClick={() => window.location.reload()}>I’ve verified my email</button>}
    <button onClick={onSignOut}>{code === 'session_revoked' || code === 'token_invalid' || code === 'token_expired' ? 'Sign in again' : 'Sign out'}</button>
  </main>;
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (!error && !notice) return null;
  return <div className={error ? 'cloud-feedback error' : 'cloud-feedback'} role={error ? 'alert' : 'status'}>{error || notice}</div>;
}

function Overview({ account, go }: { account: Account; go: (page: Page) => void }) {
  const uploads = flagOn('cloud.uploads');
  return <>
    {uploads && <section className="cloud-hero"><div><p className="cloud-eyebrow cloud-caps">Made for your next set</p><h2>Your library starts here.</h2><p>Add your tracks and SelectaDJ will prepare them for your next mix.</p><button className="primary" onClick={() => go('uploads')}>Add music</button></div><div className="cloud-hero-art" aria-hidden="true"><span>♪</span><i /><b /><em /></div></section>}
    <div className="cloud-cards"><StorageMeter account={account} /><section className="cloud-card"><p className="cloud-eyebrow cloud-caps">Current plan</p><h2>{planName(account)}</h2><p>Storage and processing limits are managed with your plan.</p><button onClick={() => go('billing')}>Manage plan</button></section>{uploads && <section className="cloud-card"><p className="cloud-eyebrow cloud-caps">Your music</p><h2>Library and uploads</h2><p>Browse private files or add tracks to your workspace.</p><button onClick={() => go('library')}>Open library</button><button onClick={() => go('uploads')}>Upload tracks</button></section>}</div>
    <RoomsCard account={account} go={go} />
  </>;
}

/** Rooms on the overview: an invitation when the account has Rooms, a locked teaser naming the
 * plan when only a plan unlocks it, and nothing at all when it's switched off. */
function RoomsCard({ account, go }: { account: Account; go: (page: Page) => void }) {
  const plan = lockedTo(account, 'rooms');
  if (plan) {
    const name = `${plan[0]?.toUpperCase() ?? ''}${plan.slice(1)}`;
    return <section className="cloud-card cloud-locked"><div><p className="cloud-eyebrow cloud-caps">{name} feature</p><h2>Host a request room</h2><p>Share a QR code so guests can add requests to your set. Rooms are part of {name}.</p></div><button onClick={() => go('billing')}>Explore {name}</button></section>;
  }
  if (!flagOn('rooms')) return null;
  return <section className="cloud-card cloud-locked"><div><p className="cloud-eyebrow cloud-caps">Rooms</p><h2>Host a request room</h2><p>Share a QR code so guests can add requests to your set.</p></div><button onClick={() => go('listen')}>Open a room</button></section>;
}
