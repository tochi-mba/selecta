import { LoginRequiredError, useAuth } from '@workos-inc/authkit-react';
import { FormEvent, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lazyPage as lazy } from '../ui/staleBuild';
import { VenueSetup } from '../autopilot/VenueSetup';
import { DevicesPanel } from '../devices/DevicesPanel';
import { DeviceCheck, showsDeviceCheck } from '../devices/DeviceCheck';
import { PLAYBACK_COMMAND_EVENT } from '../devices/usePlaybackDevice';
import { START_ANSWER_EVENT, START_ASK_EVENT } from '../devices/playOn';
import { CURRENT_MIX_EVENT } from './currentMix';
import { DEFAULT_SPEAKER_EVENT } from '../devices/useHoldings';
import { Icon } from '../ui/Icon';
import { CloudListen } from '../rooms/CloudListen';
import { RoomPanel } from '../rooms/RoomPanel';
import { ROOM_EVENT } from '../rooms/useRoomSession';
import { LUCY_TURNS_EVENT, LucyCloudSettings } from '../views/LucyCloudSettings';
import { accountFlagOn, flagOn, setAccountFeatures, useFlags } from '../flags';
import { DESTINATIONS, type MoreDestinationId } from '../shell/manifest';
import { AccountDanger, AccountData } from './AccountData';
import { SettingsLayout, settingsPlaces } from './AccountLayout';
import { AccountPage, AccountStrip } from './AccountPage';
export { AccountStrip } from './AccountPage';
import { AccountProblem, accountProblem } from './accountStates';
import { Account, apiOrigin, CloudError, holdsHostedStorage, idempotencyKey, withIdempotencyKey, isOverQuota, lockedTo, messageOf, statusWords, Page, pageShown, planName } from './api';
import { noteAuthProblem, sessionEnded } from './authTrail';
import { BlockedCode, blockedCode, callbackProblem, refusalMessage, SUSPENDED_NOTICE, withoutCallbackError } from './authConfig';
import { Billing } from './Billing';
import { PrivacyNoticeDraft, showsPrivacyDraft } from './PrivacyNoticeDraft';
import { checkoutBody, checkoutProblem, Consent, consentVersionFor, useCheckoutReturn } from './checkout';
import { CloudTransportDock, singleAudioOwner } from './CloudTransportDock';
import { ACCOUNT_STATES_FLAG, BUSINESS_FLAG, BUSINESS_JOIN_PATH, isBusinessPath, resolveRoute } from './cloudRoutes';
import { parseBusinessPath } from '../business/context';
import { AccountProblemNote, NotFound, SuspendedPanel } from './CloudStates';
import { AccountProblemPage, BlockedAccount, GateLoading, OfflineWait, SignInAgain, VerifyEmail, WorkspaceCheck } from './Gate';
import { Welcome } from './Welcome';
import { CloudEvent, useCloudEvents } from './events';
import { ROOM_REQUEST_EVENT } from './localFirstRequests';
import { CATALOGUE_CHANGED_EVENT } from './localFirstRequest';
import { LIBRARY_STATES_FLAG } from './libraryState';
import { LibraryPanel } from './Library';
import { MakeCloudMix } from './MakeCloudMix';
import { StorageMeter } from './Meters';
import { blockedByQuota, OverQuotaBanner } from './OverQuota';
import { BillingStandingNotice } from './BillingStanding';
import { WorkspaceNameOffer } from './WorkspaceNameOffer';
import { setProblemReporter, SUPPORT_EMAIL } from '../support';
import { UploadsPanel } from './Uploads';
import { isHostedAccount } from './localFirstGate';
import { LocalFirstLabs } from './labs/LocalFirstLabs';
import { ReconciliationPanel } from './migration/ReconciliationPanel';
import { navigate, useLocationText } from '../router';
import { Action, LiveRegion, Section } from '../ui/controls';
import { Toaster } from '../ui/toasts';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DeviceDataCard } from './DeviceDataCard';
import { forgetWorkspaceOnDevice } from './deviceData';
import type { HostedView } from './HostedShell';
import { isOnline, onReconnect, reportOk, useConnection } from './connection';
import { ConnectionBanner } from './ConnectionBanner';
import { forgetAccountSnapshot, rememberAccount, rememberedAccount } from './offlineCache';
import { syncOfflineShell } from './offlineShell';
import { canHeal, classify, resilient } from './resilientRequest';
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
// SelectaDJ for Business (ADR-0453 D2): the workspace at `/b/{org}`, the invitation page and the
// switcher are their own chunks, fetched only for an account with `business.workspaces` on.
const BusinessApp = lazy(() => import('../business/BusinessApp'));
const JoinOrganisation = lazy(() => import('../business/JoinOrganisation'));
const PersonalSwitcher = lazy(() => import('../business/switcher/PersonalSwitcher'));
const StartPage = lazy(() => import('../business/start/StartPage'));
// The business price list (BZ-0441-05), only for an account `business.signups` reaches.
const BusinessPricing = lazy(() => import('../business/pricing/BusinessPricing'));

/** Whether this account has the business workspace (decided on by the server, never assumed). */
export function businessShown(account: Account | null): boolean {
  return account?.features?.[BUSINESS_FLAG] === true;
}

/** The work a button starts. Each has its own busy state, so a slow checkout never greys out
 * Sign out everywhere, and the button pressed is the one that says it is working. */
type Operation = 'onboarding' | 'checkout' | 'portal' | 'everywhere' | 'delete';

/** Whether this account gets the local-first shell, decided on the account's own
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

const OFFLINE_SHELL = 'cloud.offline_shell';
/** The waits around a missing token, in one place so a test can shorten them (never changed at
 * run time otherwise):
 * - `waits`: the tries after the first miss, before "Sign in again" shows with no page open;
 * - `patienceMs`: how long a page that is open waits out a miss before that screen replaces it,
 *   asking again every `openRetryMs` once the first tries are spent;
 * - `healFirstMs`, `healMaxMs`: "Sign in again" asking by itself, the first wait and the longest. */
export const SIGN_IN_TIMING = { waits: [1500, 3000, 6000], patienceMs: 30_000, openRetryMs: 5_000, healFirstMs: 3_000, healMaxMs: 30_000 };
/** An account read that failed while the connection itself is fine (a 500, a 429) and left the
 * kept account on screen is asked again by itself: first after `firstMs`, doubling to `maxMs`. */
export const ACCOUNT_RETRY = { firstMs: 5_000, maxMs: 60_000 };
const RENEWING_WORDS = 'Renewing your sign-in. Everything on this page is kept.';

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
  const { isLoading, user, getAccessToken, signIn, signUp, signOut: authSignOut } = useAuth();
  // Every way out (sign out, sign out everywhere, delete, sign in again) forgets the account kept
  // for an offline open first (cloud.offline_shell privacy: only while signed in, only the last).
  // Every way out forgets the kept offline account. AuthKit's signOut is overloaded, so the wrapper
  // keeps its whole type instead of only its last signature.
  const signOut = useCallback(((...args: unknown[]) => {
    forgetAccountSnapshot();
    return (authSignOut as (...given: unknown[]) => unknown)(...args);
  }) as typeof authSignOut, [authSignOut]);
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

  const rawApi = useCallback(async <T,>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> => {
    let token: string;
    try {
      token = await getAccessToken();
    } catch (problem) {
      // leave a trail (name, message, status, isTransient; never a token) and carry on as before
      noteAuthProblem('getAccessToken', problem);
      throw problem;
    }
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
      throw new CloudError(refusalMessage(code) ?? messageOf(payload, statusWords(response.status)), response.status, code, payload);
    }
    return payload as T;
  }, [getAccessToken]);
  // `cloud.offline_shell`: every call goes through the resilient request layer, which feeds the
  // one connection state and says failures in plain words (resilientRequest.ts). Decided at call
  // time, so the client keeps its identity when the account's flags arrive.
  const api = useMemo(() => {
    const layered = resilient(rawApi);
    return (<T,>(path: string, init?: RequestInit, workspaceId?: string): Promise<T> => {
      // `cloud.idempotency`: one key per press, made before any retry, so a write whose answer
      // was lost is answered again by the server instead of being done twice
      const keyed = withIdempotencyKey(init, flagOn('cloud.idempotency'));
      return flagOn(OFFLINE_SHELL) ? layered<T>(path, keyed, workspaceId) : rawApi<T>(path, keyed, workspaceId);
    });
  }, [rawApi]);
  const connectionNow = useConnection();
  // A broken page's reference reaches the server log while someone is signed in (observability).
  const signedWorkspace = account?.workspace.id;
  useEffect(() => {
    if (!signedWorkspace) return undefined;
    setProblemReporter((report) => api('/account/problem-report', { method: 'POST', body: JSON.stringify(report) }, signedWorkspace));
    return () => setProblemReporter(null);
  }, [api, signedWorkspace]);
  const shownAccount = useRef(account);
  shownAccount.current = account;

  // A token getter that keeps its identity across renders, for the business app's event stream
  // (a new function every render would reconnect the stream every render).
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const stableToken = useCallback(() => tokenRef.current(), []);

  // One operation at a time per button: its own busy state, and a refusal said in the page feedback.
  const operate = useCallback(async (operation: Operation, work: () => Promise<void>) => {
    setRunning((now) => new Set(now).add(operation));
    setError('');
    try { await work(); } catch (problem) { setError((problem as Error).message); }
    finally { setRunning((now) => { const next = new Set(now); next.delete(operation); return next; }); }
  }, []);
  const busy = (operation: Operation) => running.has(operation);

  // why the last press of "Continue with ..." did not open Checkout; shown beside that button
  const [checkoutError, setCheckoutError] = useState('');
  const [signInAgain, setSignInAgain] = useState(false);
  const againShown = useRef(signInAgain);
  againShown.current = signInAgain;
  // a quiet line while a page that is open waits for the sign-in to renew
  const [renewing, setRenewing] = useState(false);
  // how many times in a row AuthKit had a user but no token, and the timer for the next try
  const loginTries = useRef(0);
  const loginRetry = useRef(0);
  // when the current run of token misses began (0: none), and whether the workspace set-up screen
  // is up: a screen the person is in the middle of is only replaced once the miss has lasted
  const missingSince = useRef(0);
  const settingUp = useRef(needsOnboarding);
  settingUp.current = needsOnboarding;
  // Every retry asks through the newest refreshAccount. A timer that called the refreshAccount it
  // was made in kept that render's token getter for good; on a fresh page load AuthKit can report
  // the user one render before it puts its real client in place of the stand-in whose getter
  // always rejects, so that timer chain could never succeed, kept counting behind a working app,
  // and showed "Sign in again" about twelve seconds after the load.
  const refreshLatest = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => () => window.clearTimeout(loginRetry.current), []);
  // the next try of an account read that failed behind a kept account, and how many have failed
  const accountRetry = useRef(0);
  const accountMisses = useRef(0);
  useEffect(() => () => window.clearTimeout(accountRetry.current), []);
  /** An answer got past the token: the run of misses is over, and so is its retry timer. */
  const tokenFound = useCallback(() => {
    window.clearTimeout(loginRetry.current);
    loginRetry.current = 0;
    loginTries.current = 0;
    missingSince.current = 0;
    setRenewing(false);
  }, []);
  const refreshAccount = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      const next = await api<Account>('/account');
      // ADR-0462 one flag read: every account load and refresh feeds flagOn before the redraw.
      setAccountFeatures(next.features);
      setAccount(next);
      setNeedsOnboarding(false);
      setProblem(null);
      setSignInAgain(false);
      tokenFound();
      window.clearTimeout(accountRetry.current);
      accountMisses.current = 0;
      if (flagOn(OFFLINE_SHELL)) rememberAccount(user.id, next);
    } catch (problem) {
      // During the sign-in redirect AuthKit can report a user a moment before it holds a token.
      // That is not an account problem: AuthKit's own state decides what shows next.
      // If it still has no token after a while, say so and offer one way back; the screen then
      // keeps asking by itself (below). Nothing on this device is cleared (songs, mixes, the
      // import journal).
      if (problem instanceof LoginRequiredError) {
        if (!missingSince.current) missingSince.current = Date.now();
        // "Sign in again" is already up: its own loop keeps asking, so nothing is scheduled here.
        if (againShown.current) return;
        // The numbers:
        // - Nothing open yet (a page load, the sign-in redirect): three more tries after 1.5 s,
        //   3 s and 6 s, about ten seconds in all, then "Sign in again". As before.
        // - A page already open (the workspace set-up, or the app): the same tries, then one
        //   every 5 s, behind a quiet "Renewing your sign-in" line from the second miss on. The
        //   page is only replaced once the miss has lasted 30 s, three times the longest the
        //   known harmless miss can last, or at once when AuthKit itself has said the session
        //   could not be renewed (onRefreshFailure, the only real sign-out).
        const waits = SIGN_IN_TIMING.waits;
        const open = settingUp.current || shownAccount.current !== null;
        const lasted = Date.now() - missingSince.current >= SIGN_IN_TIMING.patienceMs;
        const spent = loginTries.current >= waits.length;
        if (sessionEnded() || (spent && (!open || lasted))) {
          console.warn('SelectaDJ: AuthKit reports a user but no token after retries; asking to sign in again.');
          window.clearTimeout(loginRetry.current);
          setRenewing(false);
          setSignInAgain(true);
          return;
        }
        if (open && loginTries.current >= 1) setRenewing(true);
        window.clearTimeout(loginRetry.current);
        loginRetry.current = window.setTimeout(() => void refreshLatest.current(), waits[loginTries.current] ?? SIGN_IN_TIMING.openRetryMs);
        loginTries.current = Math.min(loginTries.current + 1, waits.length);
        return;
      }
      // A server's answer got past the token, so a run of token misses has ended and "Sign in
      // again" has nothing left to say (a refusal has its own page). Without this, the tries spent
      // during sign-in stayed spent on the set-up screen (its 409 is not a success), and one later
      // miss replaced that screen at once. A failure with no answer proves nothing either way.
      if (problem instanceof CloudError && problem.status > 0) {
        tokenFound();
        setSignInAgain(false);
      }
      // Offline or the service down (`cloud.offline_shell`): keep the account already shown, or
      // open with the one this device last saw; the connection banner says what is happening and
      // the account is read again when the connection is back.
      if (flagOn(OFFLINE_SHELL) && canHeal(classify(problem))) {
        const kept = shownAccount.current ? { value: shownAccount.current } : rememberedAccount(user.id);
        if (kept) {
          if (!shownAccount.current) {
            setAccountFeatures(kept.value.features);
            setAccount(kept.value);
          }
          // Coming back online reads the account again, but a failure that never took the
          // connection down (one 500, a 429) has no coming back: without another try here the
          // kept account stayed on screen, unsaid and unchecked, until something else asked.
          if (isOnline()) {
            window.clearTimeout(accountRetry.current);
            const wait = Math.min(ACCOUNT_RETRY.maxMs, ACCOUNT_RETRY.firstMs * 2 ** accountMisses.current);
            accountMisses.current += 1;
            accountRetry.current = window.setTimeout(() => void refreshLatest.current(), wait);
          }
          return;
        }
      }
      if (problem instanceof CloudError && problem.status === 409 && problem.code === 'not_onboarded') {
        setNeedsOnboarding(true);
        setAccountFeatures(null);
        setAccount(null);
      } else {
        setError((problem as Error).message);
        setProblem({ kind: accountProblem(problem), message: (problem as Error).message });
      }
    }
  }, [api, user, tokenFound]);
  refreshLatest.current = refreshAccount;

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);
  // "Sign in again" heals by itself. While it is up the account is asked for again in the
  // background: first after 3 s, each wait half as long again, never more than 30 s apart, and
  // never stopping while the screen shows. It is also asked at once when the tab is looked at
  // again, the window gets focus, the browser comes back online, or another tab stores a new
  // AuthKit refresh token. The moment a token comes back and the account reads, refreshAccount
  // takes the screen away and the person is where they were.
  useEffect(() => {
    if (!signInAgain) return undefined;
    let timer = 0;
    let wait = SIGN_IN_TIMING.healFirstMs;
    const ask = () => { void refreshLatest.current(); };
    const next = () => {
      timer = window.setTimeout(() => {
        ask();
        wait = Math.min(Math.round(wait * 1.5), SIGN_IN_TIMING.healMaxMs);
        next();
      }, wait);
    };
    const looked = () => { if (document.visibilityState === 'visible') ask(); };
    const stored = (event: StorageEvent) => { if (event.key === null || event.key.startsWith('workos:refresh-token')) ask(); };
    next();
    document.addEventListener('visibilitychange', looked);
    window.addEventListener('focus', ask);
    window.addEventListener('online', ask);
    window.addEventListener('storage', stored);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', looked);
      window.removeEventListener('focus', ask);
      window.removeEventListener('online', ask);
      window.removeEventListener('storage', stored);
    };
  }, [signInAgain]);
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
    // ADR-0475 R2: one device asking another to start, and what it answered (devices/playOn.ts)
    if (event.topic === 'playback.start_ask') window.dispatchEvent(new CustomEvent(START_ASK_EVENT, { detail: event.payload }));
    if (event.topic === 'playback.start_answer') window.dispatchEvent(new CustomEvent(START_ANSWER_EVENT, { detail: event.payload }));
    // ADR-0475 R8: another device chose the account's current mix
    if (event.topic === 'mix.current') window.dispatchEvent(new CustomEvent(CURRENT_MIX_EVENT, { detail: event.payload }));
    if (event.topic === 'lucy.turns') window.dispatchEvent(new Event(LUCY_TURNS_EVENT));
    if (event.topic === 'devices.default_speaker') window.dispatchEvent(new Event(DEFAULT_SPEAKER_EVENT));
    // a room request the host accepted, waiting for (or gone from) the browser mix's Requests
    if (event.topic === 'requests.room') window.dispatchEvent(new CustomEvent(ROOM_REQUEST_EVENT, { detail: event.payload }));
    // anything about the open room (a request, a guest, its settings, its end) reaches the shell's
    // room session, which reads the room again on whichever page the host is (useRoomSession)
    if (event.topic === 'requests.room' || event.topic.startsWith('room.')) window.dispatchEvent(new Event(ROOM_EVENT));
    if (event.topic.startsWith('upload.') || event.topic.startsWith('asset.')) { void refreshAccount(); setLibraryVersion((value) => value + 1); }
    // the browser-first catalogue is kept until the library changes (localFirstRequest.ts)
    if (/^(upload|asset|library|local_media)\./.test(event.topic)) window.dispatchEvent(new Event(CATALOGUE_CHANGED_EVENT));
  }, [refreshAccount]);
  const refreshAll = useCallback(async () => { await refreshAccount(); }, [refreshAccount]);
  const stream = useCloudEvents({ token: getAccessToken, workspaceId: account?.workspace.id ?? null, onEvent, refresh: refreshAll });
  // a live event stream is the connection answering; coming back reads the account again
  useEffect(() => { if (stream === 'live' && flagOn(OFFLINE_SHELL)) reportOk(); }, [stream]);
  useEffect(() => onReconnect(() => { if (flagOn(OFFLINE_SHELL)) void refreshAccount(); }), [refreshAccount]);
  // the app-shell service worker, only in Cloud with the flag on; off, it is removed
  const offlineShellOn = account !== null && flagOn(OFFLINE_SHELL);
  useEffect(() => { if (account) void syncOfflineShell(offlineShellOn); }, [account, offlineShellOn]);
  // Opened with no connection: AuthKit cannot renew the sign-in until it is back, so a member who
  // has used SelectaDJ here is told that plainly instead of seeing the welcome page, and the page
  // opens by itself on reconnect.
  const connectionDown = flagOn(OFFLINE_SHELL) && connectionNow.status !== 'online';
  // A local-first account opens the browser shell from the account this device last saw, in an
  // explicit offline mode: the library from this device, local files play, mixes are queued, and
  // anything only the server can do waits with its reason. Any other account waits on a page.
  const offlineCandidate = !isLoading && !user && connectionDown ? rememberedAccount() : null;
  const offlineUsable = offlineCandidate !== null && localFirstDecided(offlineCandidate.value);
  const [offlineMode, setOfflineMode] = useState(false);
  useEffect(() => {
    if (!offlineUsable || offlineMode || !offlineCandidate) return;
    setAccountFeatures(offlineCandidate.value.features);
    setAccount(offlineCandidate.value);
    setOfflineMode(true);
  }, [offlineUsable, offlineMode, offlineCandidate]);
  // Signed in again: the normal path takes over with the same shell still mounted, and the
  // account is read fresh. AuthKit is asked on reconnect; if it says the sign-in has ended, the
  // offline mode closes and the sign-in page shows.
  useEffect(() => { if (user && offlineMode) setOfflineMode(false); }, [user, offlineMode]);
  useEffect(() => {
    if (!offlineMode || user) return undefined;
    return onReconnect(() => {
      getAccessToken().catch((problem: unknown) => {
        if (classify(problem) !== 'signed_out') return;
        forgetAccountSnapshot();
        setOfflineMode(false);
        setAccountFeatures(null);
        setAccount(null);
      });
    });
  }, [offlineMode, user, getAccessToken]);
  const waitingOffline = !isLoading && !user && !offlineMode && offlineCandidate !== null && !offlineUsable;
  useEffect(() => (waitingOffline ? onReconnect(() => window.location.reload()) : undefined), [waitingOffline]);

  const checkout = useCheckoutReturn(account, refreshAccount);
  const consentVersion = consentVersionFor(account);

  const startSignIn = () => signIn({ state: { returnTo: `${window.location.pathname}${window.location.search}` } });
  // The button on "Sign in again" first asks quietly: a token that is there after all reads the
  // account and takes the screen away. Only AuthKit saying a sign-in is needed starts the redirect.
  const signInAgainPressed = async () => {
    try {
      await tokenRef.current();
    } catch (problem) {
      noteAuthProblem('sign-in-again button', problem);
      if (problem instanceof LoginRequiredError) { await startSignIn(); return; }
      // it could not be asked (no connection, say): stay here, the screen keeps trying
      return;
    }
    await refreshLatest.current();
  };

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
    setCheckoutError('');
    await operate('checkout', async () => {
      try {
        const result = await api<{ url: string }>('/billing/checkout', {
          method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
          body: JSON.stringify(checkoutBody(plan, interval, consent, consentVersion, checkout === 'cancelled')),
        }, account.workspace.id);
        window.location.assign(result.url);
      } catch (problem) {
        // said beside the button that was pressed (Billing's hint line), not in a banner far above
        setCheckoutError(checkoutProblem(problem));
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
      // ADR-0469: a deleted account leaves nothing on this device (song index, folder, marker).
      if (account) await forgetWorkspaceOnDevice(account.workspace.id);
      signOut({ returnTo: window.location.origin });
    });
  };
  const deleteDialog = confirmingDelete && (
    <ConfirmDialog
      destructive
      title="Delete your SelectaDJ Cloud account?"
      body={`It is hidden and you are signed out at once. It is erased for good after 30 days; until then, write to ${SUPPORT_EMAIL} to keep it. A paid plan is cancelled straight away, with no refund for the rest of the period, and does not come back if the account is restored.`}
      confirmLabel="Delete my account"
      cancelLabel="Keep my account"
      working="Deleting…"
      onConfirm={async () => {
        // the dialog stays open and says why when the server refuses
        await api('/account', { method: 'DELETE' }, account?.workspace.id);
        if (account) await forgetWorkspaceOnDevice(account.workspace.id);
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
  const restartSignIn = async () => {
    try {
      await signOut({ returnTo: window.location.origin });
    } catch {
      // AuthKit can retain a user in memory after its server-side session is already gone. In
      // that recovery state signOut throws; start a new authorization flow instead of trapping
      // the person on the token-invalid page.
      await signIn({ state: { returnTo: window.location.pathname } });
    }
  };

  if (isLoading) return <GateLoading label="Checking your sign-in…" />;
  if (waitingOffline) return <OfflineWait />;
  if (!user && (offlineMode || offlineUsable)) {
    return (
      <Suspense fallback={<GateLoading label="Opening SelectaDJ…" />}>
        {offlineMode && account
          ? <LocalFirstShell api={api} account={account} more={() => <p className="needs-connection">This needs the internet. You’ll be signed in again when the connection is back.</p>} offlineReadOnly />
          : <GateLoading label="Opening SelectaDJ…" />}
      </Suspense>
    );
  }
  if (!user) return <Welcome problem={signInProblem} onSignIn={startSignIn} onSignUp={() => signUp({ state: { returnTo: `${window.location.pathname}${window.location.search}` } })} />;
  if (signInAgain) return <SignInAgain onSignIn={signInAgainPressed} />;
  if (blocked) return <BlockedAccount code={blocked} distinct={exact} email={user.email} onSignOut={() => restartSignIn()} />;
  if (!user.emailVerified) return <VerifyEmail email={user.email} onSignOut={() => signOut({ returnTo: window.location.origin })} />;
  if (needsOnboarding) return <WorkspaceCheck email={user.email} confirmed={ageConfirmed} onConfirmed={setAgeConfirmed} busy={busy('onboarding')} error={error} onSubmit={(event) => void completeOnboarding(event)} onSignOut={() => signOut({ returnTo: window.location.origin })} />;

  // No account could be read at all: say why, instead of an empty workspace (AV-0420-03).
  if (exact && !account && problem) return <AccountProblemPage kind={problem.kind} retrying={retrying} email={user.email} onRetry={() => void retryAccount()} onSignOut={() => signOut({ returnTo: window.location.origin })} />;

  if ((exact ? route.kind === 'admin' : inAdmin) && showsAdmin(account)) {
    const leave = () => { setInAdmin(false); window.history.pushState({}, '', '/'); setPage('home'); setPath('/'); };
    return <Suspense fallback={<main className="cloud-runtime-message"><p>Opening the staff console…</p></main>}><AdminArea token={getAccessToken} onLeave={leave} origin={apiOrigin} email={user.email} features={account?.features ?? null} onSignInAgain={() => void signIn({ state: { returnTo: `${window.location.pathname}${window.location.search}` } })} /></Suspense>;
  }

  // The business workspace (`/b/{org}`) and its invitation page, only with the flag on; off, the
  // address is not found like any other and nothing business is fetched.
  const openPath = (next: string) => { window.history.pushState({}, '', next); setPath(next); setPage(pageFor(next)); };
  if (account && account.features?.['business.signups'] === true && path.replace(/\/+$/, '') === '/business/pricing') {
    return <Suspense fallback={<main className="cloud-runtime-message"><p>Loading prices…</p></main>}><BusinessPricing api={api} onLeave={() => openPath('/')} /></Suspense>;
  }
  // `/business/start` (ADR-0453 S1): the pilot contact form, or naming an organisation once
  // sign-up is on; only with `business.start` on.
  if (account && account.features['business.start'] === true && path.replace(/\/+$/, '') === '/business/start') {
    return <Suspense fallback={null}><StartPage api={api} signups={account.features['business.signups'] === true} onOpen={openPath} /></Suspense>;
  }
  if (account && businessShown(account) && isBusinessPath(path)) {
    const leaveBusiness = () => openPath('/');
    const businessRoute = parseBusinessPath(path);
    return (
      <Suspense fallback={<main className="cloud-runtime-message"><p>Opening your organisation…</p></main>}>
        {normalizedJoin(path)
          ? <JoinOrganisation api={api} onOpen={openPath} />
          : businessRoute && businessRoute.page !== 'start' && <BusinessApp api={api} route={businessRoute} account={account} onLeaveToPersonal={leaveBusiness} token={stableToken} />}
      </Suspense>
    );
  }
  const businessEntry = account && businessShown(account) ? <Suspense fallback={null}><PersonalSwitcher api={api} account={account} open={openPath} /></Suspense> : null;
  const quotaBlock = blockedByQuota(account);
  const signOutHere = () => signOut({ returnTo: window.location.origin });
  const openAdmin = () => { setInAdmin(true); window.history.pushState({}, '', '/admin'); setPath('/admin'); };
  // Both shared shells have their own router: a hosted page moves to the same address there,
  // which they serve from More (Account, Plan & billing, Add music) or their own pages.
  const goShell = (next: Page) => navigate(PATHS[next]);
  // the shared shells have no rail, so the account page says who is signed in and offers leaving
  const framed = localFirst || hostedShell;
  // Account, Plan & billing and Devices share one section list; the legacy frame has no pages for it.
  const lucySettings = !!account && accountFlagOn('lucy', account.features) && accountFlagOn('account.lucy_settings', account.features);
  const labsShown = !!account && (flagOn('cloud.local_first_labs') || account.experience?.local_first === true);
  const venueSetup = flagOn('autopilot.venue_mode') && flagOn('autopilot.venue_policy');
  const places = account && framed ? settingsPlaces({ devices: flagOn('devices'), lucy: lucySettings, advanced: showsDeviceCheck(account.features) || flagOn('cloud.venue_tablet') || labsShown || venueSetup }) : undefined;
  const settingsPanel = account ? <AccountPage
    places={places}
    profile={[
      <AccountStrip email={user.email} plan={planName(account)} workspace={account.workspace.name} onSignOut={signOutHere} onStaffConsole={showsAdmin(account) ? openAdmin : undefined} />,
      framed && businessEntry,
      <WorkspaceNameOffer account={account} rename={async (name) => { await api('/account/workspace-name', { method: 'PUT', body: JSON.stringify({ name }) }, account.workspace.id); await refreshAccount(); }} />,
      framed && lockedTo(account, 'rooms') && <RoomsCard account={account} go={goShell} />,
      !framed && flagOn('devices') && <DevicesPanel api={api} workspaceId={account.workspace.id} />,
    ]}
    lucy={[lucySettings && <LucyCloudSettings request={workspaceRequest} features={account.features} />]}
    data={[
      <AccountData token={getAccessToken} workspaceId={account.workspace.id} features={account.features} withAudio={holdsHostedStorage(account)} />,
      localFirst && isHostedAccount(account) && accountFlagOn('cloud.stored_media', account.features) && <ReconciliationPanel request={workspaceRequest} />,
      localFirst && flagOn('cloud.local_media') && !flagOn('cloud.workspace') && <DeviceDataCard workspaceId={account.workspace.id} onCleared={() => window.location.reload()} />,
      showsPrivacyDraft(account.features) && <PrivacyNoticeDraft />,
    ]}
    advanced={[
      labsShown && <LocalFirstLabs request={<T,>(path: string, init?: RequestInit) => api<T>(path, init, account.workspace.id)} onChanged={() => void refreshAccount()} />,
      showsDeviceCheck(account.features) && <DeviceCheck />,
      flagOn('cloud.venue_tablet') && <Suspense fallback={null}><VenuePosture workspaceId={account.workspace.id} places={{ localFirst, devices: flagOn('devices'), rooms: flagOn('rooms'), library: localFirst || pageShown(account, 'library') }} /></Suspense>,
      venueSetup && <VenueSetup api={api} workspaceId={account.workspace.id} />,
    ]}
    danger={[(exact || hostedShell) && <AccountDanger busy={busy('everywhere') || busy('delete')} onSignOutEverywhere={signOutEverywhere} onDelete={deleteAccount} />]}
  /> : null;
  const billing = account && <SettingsLayout current="billing" places={places}><Billing account={account} busy={busy('checkout') || busy('portal')} phase={checkout} consentVersion={consentVersion} error={checkoutError} blocked={isOverQuota(account)} onCheckout={(plan, interval, consent) => void openCheckout(plan, interval, consent)} onPortal={() => void openPortal()} /></SettingsLayout>;
  const uploads = account && <UploadsPanel api={api} workspaceId={account.workspace.id} setError={setError} setNotice={setNotice} blocked={quotaBlock} onAccepted={() => void refreshAccount()} perFile={flagOn(LIBRARY_STATES_FLAG)} />;
  // The account places behind More, one drawing for both shared shells.
  const morePanel = (id: MoreDestinationId): ReactNode => {
    if (!account) return null;
    switch (id) {
      case 'account': return settingsPanel;
      case 'billing': return billing;
      case 'devices': return <SettingsLayout current="devices" places={places}><DevicesPanel api={api} workspaceId={account.workspace.id} titled={false} /></SettingsLayout>;
      case 'rooms': return <RoomPanel api={api} workspaceId={account.workspace.id} locked={account.feature_locks.rooms} votesOn={flagOn('rooms.votes')} displayOn={flagOn('rooms.display')} playHereOn={flagOn('devices')} freshOnly={account.features['rooms.nickname_confirm'] === true} />;
      case 'uploads': return uploads;
      case 'workspace': return null;
    }
  };
  // The hosted frame's account notices, in a shared shell's banner slot (one source for every frame).
  // The local-first shell draws its own connection banner, which also says when its library is
  // served from this device.
  const shellNotices = account && <>
    {flagOn(OFFLINE_SHELL) && !localFirst && <ConnectionBanner />}
    {account.user.suspended && (exact ? <SuspendedPanel go={goShell} /> : <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>)}
    {problem && <AccountProblemNote kind={problem.kind} onRetry={() => void retryAccount()} />}
    <OverQuotaBanner account={account} go={goShell} />
    {place !== PATHS.billing && <BillingStandingNotice account={account} place="shell" busy={busy('portal')} onPortal={() => void openPortal()} />}
    {renewing && <p className="cloud-stream-note" role="status">{RENEWING_WORDS}</p>}
    {stream === 'polling' && !connectionDown && <p className="cloud-stream-note" role="status">Live updates are paused on this network, so this page checks for changes every few seconds.</p>}
  </>;
  const shellFeedback = <Feedback error={problem && error === problem.message ? '' : error} notice={notice} />;

  // ADR-0462/0463: an account with the local-first experience, and `cloud.local_first` on, gets the
  // shared shell. With either off, everything below renders exactly as before.
  if (account && localFirst) {
    return (
      <Suspense fallback={<GateLoading label="Opening SelectaDJ…" />}>
        <LocalFirstShell api={api} account={account} more={morePanel} notices={shellNotices} feedback={shellFeedback} onSignOut={signOutHere} />
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
      <Suspense fallback={<GateLoading label="Opening SelectaDJ…" />}>
        <HostedShell
          account={account}
          signedIn={{ email: user.email, plan: planName(account), onSignOut: signOutHere, onStaffConsole: showsAdmin(account) ? openAdmin : undefined }}
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
        <div className="cloud-rail-bottom">{businessEntry}{showsAdmin(account) && <button onClick={openAdmin}>Staff console</button>}<span>{user.email}</span>{exact && <button onClick={signOutHere}>Sign out</button>}
          <Action run={signOutEverywhere} disabled={busy('everywhere')}>Sign out everywhere</Action>
          <button className="cloud-delete-account" onClick={() => setConfirmingDelete(true)} disabled={busy('delete')}>Delete account</button></div>
      </aside>
      <main className="cloud-main">
        <header className="cloud-top"><div><p className={account ? 'cloud-eyebrow' : 'cloud-eyebrow cloud-caps'}>{account?.workspace.name ?? 'Your workspace'}</p><h1 ref={titleRef} tabIndex={-1}>{notFound ? 'Page not found' : TITLES[shown]}</h1></div><span className="cloud-plan-chip">{account ? planName(account) : 'Free'} plan</span></header>
        {account?.user.suspended && (exact ? <SuspendedPanel go={choosePage} /> : <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>)}
        {exact && account && problem && <AccountProblemNote kind={problem.kind} onRetry={() => void retryAccount()} />}
        <OverQuotaBanner account={account} go={choosePage} />
        {account && view !== 'billing' && <BillingStandingNotice account={account} place="shell" busy={busy('portal')} onPortal={() => void openPortal()} />}
        {renewing && <p className="cloud-stream-note" role="status">{RENEWING_WORDS}</p>}
        {stream === 'polling' && !connectionDown && <p className="cloud-stream-note" role="status">Live updates are paused on this network, so this page checks for changes every few seconds.</p>}
        {flagOn(OFFLINE_SHELL) && <ConnectionBanner />}
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

/** Who makes SelectaDJ, shown once at the foot of Cloud pages. */
export function CloudCredit() {
  return <span className="cloud-credit">SelectaDJ is a REX Technologies product. © {new Date().getFullYear()} REX Technologies</span>;
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (!error && !notice) return null;
  return <div className={error ? 'cloud-feedback error' : 'cloud-feedback'} role={error ? 'alert' : 'status'}>{error || notice}</div>;
}

function Overview({ account, go }: { account: Account; go: (page: Page) => void }) {
  const uploads = flagOn('cloud.uploads');
  return <>
    {uploads && <section className="cloud-hero"><div><p className="cloud-eyebrow cloud-caps">Made for your next set</p><h2>Your library starts here.</h2><p>Add your tracks and SelectaDJ will prepare them for your next mix.</p><button className="primary" onClick={() => go('uploads')}>Add music</button></div><div className="cloud-hero-art" aria-hidden="true"><Icon name="music" size="hero" /><i /><b /><em /></div></section>}
    <div className="cloud-cards"><StorageMeter account={account} /><section className="cloud-card"><p className="cloud-eyebrow cloud-caps">Current plan</p><h2>{planName(account)}</h2><p>{holdsHostedStorage(account) ? 'Storage and processing limits are managed with your plan.' : 'Your plan sets what SelectaDJ does for you.'}</p><button onClick={() => go('billing')}>Manage plan</button></section>{uploads && <section className="cloud-card"><p className="cloud-eyebrow cloud-caps">Your music</p><h2>Library and uploads</h2><p>Browse private files or add tracks to your workspace.</p><button onClick={() => go('library')}>Open library</button><button onClick={() => go('uploads')}>Upload tracks</button></section>}</div>
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

function normalizedJoin(path: string) {
  return path.replace(/\/+$/, '') === BUSINESS_JOIN_PATH;
}
