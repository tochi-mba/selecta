// The SelectaDJ for Business app (ADR-0453 D2, BZ-0453-01). CloudApp renders it, as its own lazy
// chunk, for `/b/{org}/...` when `business.workspaces` is on for the account.
//
// It loads the organisation named in the route (its `workspace_id` then goes as X-Workspace-ID on
// every call), keeps `now` ticking every 10 s, tracks Offline (browser events plus three failed
// reads in 30 s, state.ts), follows live updates (`zone.`, `venue.`, `entitlement.`, `business.`
// refresh the overview, so a pilot ending turns pages read-only live) with a 10 s poll when the
// stream is down, and provides BusinessContext to the pages.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Account, Api, CloudError } from '../cloud/api';
import { CloudEvent, StreamState, useCloudEvents } from '../cloud/events';
import { LiveRegion, Problem } from '../ui/controls';
import { showToast, Toaster } from '../ui/toasts';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { businessClient } from './client';
import { AssertiveRegion } from './components/Notices';
import { BusinessContext, BusinessCtx, businessOn, BusinessRoute, parseBusinessPath } from './context';
import { SHELL_COPY, SWITCHER_COPY } from './copy/shell';
import { BusinessShell } from './shell/BusinessShell';
import { landingPath } from './shell/nav';
import { BusinessPage } from './shell/pages';
import { OfflineTracker, readOnly as isReadOnly } from './state';
import type { SwitcherDevice } from './switcher/WorkspaceSwitcher';
import type { Overview } from './types';
import { rememberedWorkspace, rememberWorkspace } from './workspace';
import './business.css';

export const BUSINESS_TOPICS = ['zone.', 'venue.', 'entitlement.', 'business.'];
const TICK_MS = 10_000;
const REVEAL_MS = 120;
const noToken = async () => '';

type Load = 'loading' | 'ready' | 'missing' | 'failed';

export type BusinessAppProps = {
  api: Api;
  route: BusinessRoute;
  account: Account;
  onLeaveToPersonal: () => void;
  /** The sign-in token for the live event stream. Without it the app polls every 10 s. */
  token?: () => Promise<string>;
  /** Epoch seconds; tests and the harness freeze it. */
  clock?: () => number;
  /** Forces Offline (harness `?offline=1`). */
  forceOffline?: boolean;
  /** Forces the stream state (harness `?stream=polling`). */
  stream?: StreamState;
  /** What this device is doing, for the switcher's guards (see SwitcherDevice). */
  device?: SwitcherDevice;
};

export default function BusinessApp({ api, route, account, onLeaveToPersonal, token, clock, forceOffline, stream: forcedStream, device }: BusinessAppProps) {
  const on = businessOn(account.features, 'business.workspaces');
  const [current, setCurrent] = useState<BusinessRoute>(route);
  useEffect(() => { setCurrent(route); }, [route]);
  const leave = useRef(onLeaveToPersonal);
  leave.current = onLeaveToPersonal;

  useEffect(() => {
    const follow = () => {
      const next = parseBusinessPath(window.location.pathname);
      if (next) setCurrent(next);
      else leave.current();
    };
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  const go = useCallback((path: string) => {
    const next = parseBusinessPath(new URL(path, window.location.origin).pathname);
    if (window.location.pathname + window.location.search !== path) window.history.pushState({}, '', path);
    if (next) setCurrent(next);
    else leave.current();
  }, []);

  const tickNow = useCallback(() => (clock ? clock() : Math.floor(Date.now() / 1000)), [clock]);
  const [now, setNow] = useState(tickNow);
  useEffect(() => {
    const id = window.setInterval(() => setNow(tickNow()), TICK_MS);
    return () => window.clearInterval(id);
  }, [tickNow]);

  // Offline: the browser's events, or three failed reads in 30 s.
  const tracker = useRef(new OfflineTracker());
  const [netTick, setNetTick] = useState(0);
  useEffect(() => {
    const bump = () => setNetTick((value) => value + 1);
    window.addEventListener('online', bump);
    window.addEventListener('offline', bump);
    return () => { window.removeEventListener('online', bump); window.removeEventListener('offline', bump); };
  }, []);
  const offline = Boolean(forceOffline) || tracker.current.offline();
  void netTick;

  const orgId = current && current.page !== 'start' ? current.org : null;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [revealed, setRevealed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const workspaceId = overview?.org.workspace_id;
  const client = useMemo(() => businessClient(api, workspaceId), [api, workspaceId]);

  const read = useCallback(async (target: string, scoped?: string) => {
    const org = scoped ? null : await businessClient(api).org(target);
    const wsId = scoped ?? org!.workspace_id;
    const next = await businessClient(api, wsId).overview(target);
    return { org: org ?? next.org, next };
  }, [api]);

  useEffect(() => {
    if (!on || !orgId) return;
    let live = true;
    setLoad('loading');
    setRevealed(false);
    const reveal = window.setTimeout(() => { if (live) setRevealed(true); }, REVEAL_MS);
    read(orgId)
      .then(({ org, next }) => {
        if (!live) return;
        // A deep link from another workspace switches this tab, and says so (D9).
        const before = rememberedWorkspace(account.user.id);
        if (before && before !== org.workspace_id) showToast(SWITCHER_COPY.switched(org.name));
        rememberWorkspace(account.user.id, org.workspace_id);
        tracker.current.succeeded();
        setOverview(next);
        setUpdatedAt(tickNow());
        setLoad('ready');
      })
      .catch((problem) => {
        if (!live) return;
        tracker.current.failed();
        setNetTick((value) => value + 1);
        setLoad(problem instanceof CloudError && problem.status === 404 ? 'missing' : (problem as { status?: number })?.status === 404 ? 'missing' : 'failed');
      });
    return () => { live = false; window.clearTimeout(reveal); };
  }, [on, orgId, read, account.user.id, tickNow]);

  const refresh = useCallback(async () => {
    if (!orgId || !workspaceId) return;
    try {
      const { next } = await read(orgId, workspaceId);
      tracker.current.succeeded();
      setOverview(next);
      setUpdatedAt(tickNow());
    } catch {
      // A failed refresh keeps the last state with its time; three in 30 s mean Offline.
      tracker.current.failed();
    } finally {
      setNetTick((value) => value + 1);
    }
  }, [orgId, workspaceId, read, tickNow]);

  const onEvent = useCallback((event: CloudEvent) => {
    if (BUSINESS_TOPICS.some((topic) => event.topic.startsWith(topic))) void refresh();
  }, [refresh]);
  const streamed = useCloudEvents({ token: token ?? noToken, workspaceId: token && !forcedStream && on ? workspaceId ?? null : null, onEvent, refresh });
  const stream: StreamState = forcedStream ?? (token ? streamed : 'polling');
  useVisiblePoll(refresh, TICK_MS, load === 'ready' && (!token || forcedStream === 'polling'));

  const retry = useCallback(async () => {
    if (!orgId) return;
    setLoad('loading');
    try {
      const { next } = await read(orgId);
      setOverview(next); setUpdatedAt(tickNow()); setLoad('ready'); tracker.current.succeeded();
    } catch (problem) {
      tracker.current.failed();
      setLoad((problem as { status?: number })?.status === 404 ? 'missing' : 'failed');
    }
  }, [orgId, read, tickNow]);

  // Landing (D2): `/b/{org}` sends staff to S4 and single-venue managers to S3.
  const org = overview?.org;
  useEffect(() => {
    if (!org || current?.page !== 'hq') return;
    const target = landingPath(org);
    if (target !== window.location.pathname && parseBusinessPath(target)?.page !== 'hq') {
      window.history.replaceState({}, '', target);
      setCurrent(parseBusinessPath(target));
    }
  }, [org, current]);

  const value = useMemo<BusinessCtx | null>(() => overview && {
    org: overview.org,
    venues: overview.venues,
    devices: overview.devices ?? [],
    activity: overview.activity ?? [],
    client,
    now,
    offline,
    updatedAt,
    health: { stream },
    loading: load === 'loading',
    readOnly: isReadOnly(overview.org, now),
    refresh,
    go,
  }, [overview, client, now, offline, updatedAt, stream, load, refresh, go]);

  // With `business.workspaces` off, business pages are unreachable: CloudApp shows personal.
  if (!on || !current || current.page === 'start') return null;

  if (!value) {
    return (
      <div className="biz biz-runtime">
        {load === 'missing' && <><h1>Organisation not found</h1><Problem>{SHELL_COPY.missingOrg}</Problem><button onClick={() => leave.current()}>{SHELL_COPY.backToPersonal}</button></>}
        {load === 'failed' && <><h1>Couldn't open this organisation</h1><Problem retry={retry}>{SHELL_COPY.loadFailed}</Problem></>}
        {load === 'loading' && revealed && <p className="biz-quiet" role="status">{SHELL_COPY.loadingOrg}</p>}
      </div>
    );
  }

  const staff = value.org.role === 'staff';
  const staffVenue = staff ? (current.page === 'control' ? current.venue : value.org.venue_scope?.[0]) : null;
  const page: NonNullable<BusinessRoute> = staff && staffVenue ? { page: 'control', org: value.org.id, venue: staffVenue } : current;
  const wall = current.page === 'hq' && new URLSearchParams(window.location.search).get('wall') === '1';

  return (
    <BusinessContext.Provider value={value}>
      <BusinessShell org={value.org} route={page} api={api} account={account} now={now} readOnly={value.readOnly} offline={offline}
        wall={wall} device={device} go={go} onLeaveToPersonal={() => leave.current()}>
        {staff && !staffVenue
          ? <section className="biz-stack"><h1>Staff controls</h1><p>{SHELL_COPY.staffNoVenue}</p></section>
          : <BusinessPage route={page} org={value.org} wall={wall} />}
      </BusinessShell>
      <AssertiveRegion />
      <LiveRegion />
      <Toaster />
    </BusinessContext.Provider>
  );
}
