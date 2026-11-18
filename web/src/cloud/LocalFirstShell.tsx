import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixData, Request, Status } from '../api';
import { setFlags, useFlags } from '../flags';
import { makeCoexistingResolver, makeResolver, makeSourceBook, MediaStore, storageSpace, type MediaResolver, type StorageSpace } from '../media';
import type { NowState } from '../player';
import { BytesContext, noBytesHere, RequestContext } from '../requestContext';
import { navigate, parseRoute, useLocationText } from '../router';
import { describeRoute, destinationOf, DESTINATIONS, moreDestinationsFor, moreRouteOf, type MoreDestinationId, type ShellRoute } from '../shell/manifest';
import { Shell } from '../shell/Shell';
import { setJobsSource } from '../state/jobs';
import { showToast } from '../ui/toasts';
import { Library } from '../views/Library';
import { Mixes } from '../views/Mixes';
import { MyMixes } from '../views/MyMixes';
import { Now } from '../views/Now';
import type { View, ViewProps } from '../views/shared';
import type { Account, Api } from './api';
import { ConnectMusic } from './ConnectMusic';
import { hostedResolver } from './hostedMedia';
import { isHostedAccount } from './localFirstGate';
import { CannotPlayHere, LibraryEmpty, ListenEmpty, MixesEmpty, MyMixesEmpty, NotOnThisAccount, OnlyOnYourComputer } from './LocalFirstEmpty';
import { useLocalFirstPlayer } from './localFirstPlayer';
import { EMPTY_MIX, localFirstRequest, mediaRequest } from './localFirstRequest';
import { QueueSources } from './QueueSources';
import { CutoverNotice } from './migration/CutoverNotice';
import { OnboardingSpine } from './onboarding/OnboardingSpine';
import { onboardingFinished } from './onboarding/state';

/** Local-first personal Cloud on the shared shell (ADR-0462, ADR-0463).
 *
 * The same Shell, manifest, router and views as local mode: Listen, Make a Mix, My Mixes and
 * Library, with Cloud's own surfaces in More. Views ask through the adapted, authenticated request
 * (localFirstRequest.ts); the player is the browser engine through the playback session
 * (localFirstPlayer.ts). CloudApp mounts this only when the account has the local-first experience
 * and `cloud.local_first` is on; otherwise the hosted pages render exactly as before.
 */

/** Shell features served by this computer's own server and not by the browser runtime yet. The
 * shell reads them through the one flag read, so their buttons are gone rather than dead. */
export const NOT_IN_THE_BROWSER = {
  requests: false,
  editor: false,
  drafts: false,
  'app.activity': false,
  'app.command_palette': false,
  'app.shortcuts': false,
  export: false,
  lucy: false,
} as const;

const VIEW_PATHS: Record<View, string> = { Mixes: '/mixes', Now: '/listen', Edit: '/mix/current/edit', Library: '/library', Words: '/discover', Workshop: '/workshop' };
const IDLE = (): void => {};

export function LocalFirstShell({ api, account, more, feedback }: {
  api: Api;
  account: Account;
  /** The account panel for a More destination, drawn by CloudApp with its own handlers. */
  more: (id: MoreDestinationId) => ReactNode;
  feedback?: ReactNode;
}) {
  const workspaceId = account.workspace.id;
  const on = useFlags();
  const cloud = useCallback(<T,>(path: string, init?: RequestInit) => api<T>(path, init, workspaceId), [api, workspaceId]) as Request;
  const request = useMemo(() => localFirstRequest(cloud), [cloud]);
  const media = useMemo(() => mediaRequest(cloud), [cloud]);
  const store = useRef<Promise<MediaStore> | null>(null);
  const openStore = useCallback(() => (store.current ??= MediaStore.open()), []);
  const resolving = useRef<Promise<MediaResolver> | null>(null);
  // Device first, hosted fallback (ADR-0465): only a grandfathered account with stored media
  // readable gets the hosted path; every answer lands in the source book the queue shows.
  const book = useMemo(() => makeSourceBook(), []);
  const coexisting = isHostedAccount(account) && on('cloud.stored_media');
  const programme = useRef<MixData['mix']>([]);
  const resolver = useCallback(async () => (resolving.current ??= openStore().then((opened) => makeCoexistingResolver({
    device: makeResolver(opened),
    hosted: coexisting ? hostedResolver(api, workspaceId, {
      songs: () => programme.current,
      shaOf: async (songId) => (await opened.get(songId))?.identity.content_sha256 ?? null,
    }) : null,
    book,
  }))), [openStore, coexisting, api, workspaceId, book]);

  const [status, setStatus] = useState<Status | null>(null);
  const [statusProblem, setStatusProblem] = useState('');
  const [data, setData] = useState<MixData>(EMPTY_MIX);
  programme.current = data.mix;
  const refreshStatus = useCallback(() => {
    request<Status>('/status')
      .then((next) => { setStatus(next); setStatusProblem(''); })
      .catch((error: Error) => setStatusProblem(error.message));
  }, [request]);
  const refreshMix = useCallback(() => { request<MixData>('/mix').then(setData).catch(() => undefined); }, [request]);
  useEffect(() => { refreshStatus(); refreshMix(); }, [refreshStatus, refreshMix]);

  // This shell has no local server: the shell's job badge and the local-only buttons stand down
  // while it is open, and come back exactly as they were when it closes.
  useEffect(() => {
    setJobsSource(false);
    setFlags({ ...NOT_IN_THE_BROWSER });
    return () => { setJobsSource(true); setFlags(null); };
  }, []);

  const { player, refusal } = useLocalFirstPlayer({
    api, workspaceId, mix: data.mix, remoteControl: on('devices.remote_control'), resolver,
  });
  const [now, setNow] = useState<NowState>(player.state);
  useEffect(() => {
    player.onChange = setNow;
    setNow(player.state);
    return () => { player.onChange = IDLE; };
  }, [player]);

  const path = useLocationText().split('?')[0];
  const route: ShellRoute = moreRouteOf(path) ?? parseRoute(path);
  const moreItems = moreDestinationsFor({ mode: 'cloud', feature: on, experience: account.experience ?? null });
  const connected = status?.counts.music ?? 0;
  const [spine, setSpine] = useState(() => !onboardingFinished(workspaceId));
  const newMember = spine && status !== null && connected === 0;

  const notify = useCallback<ViewProps['notify']>((message, undo) => {
    showToast(message, typeof undo === 'function' ? { undo } : {});
  }, []);
  const shared: ViewProps | null = status && {
    status, mix: data.mix, mixName: data.name, currentMixName: data.name, canUndo: data.can_undo, mixEta: data.eta,
    refreshMix, setMixData: setData, refreshStatus, request, player, now,
    setView: (view: View) => navigate(VIEW_PATHS[view]), notify, stage: false, toggleStage: IDLE,
  };
  const song = data.mix[now.position];
  const connect = <ConnectMusic request={media} workspaceId={workspaceId} openStore={openStore} onImported={refreshStatus} />;

  const page = (): ReactNode => {
    if (route.page === 'more') {
      const item = moreItems.find((place) => place.id === route.id);
      if (!item) return <NotOnThisAccount />;
      if (item.id === 'workspace') return <ThisDevice openStore={openStore}>{connect}</ThisDevice>;
      return <main className="page" id="main"><h1 className="display small">{item.label}</h1><div className="stack">{more(item.id)}</div></main>;
    }
    if (!shared) {
      return <main className="page" id="main" aria-busy={!statusProblem}><h1 className="display small">{describeRoute(route).title}</h1>{statusProblem ? <p role="alert">{statusProblem}</p> : <p className="hint">Opening your library…</p>}</main>;
    }
    if (newMember) {
      return (
        <main className="page" id="main">
          <h1 className="display small">Welcome to SelectaDJ</h1>
          <OnboardingSpine request={media} workspaceId={workspaceId} onDone={() => { setSpine(false); refreshStatus(); }} />
          <button className="quiet" onClick={() => setSpine(false)}>Look around first</button>
        </main>
      );
    }
    switch (route.page) {
      case 'library':
        return connected === 0
          ? <main className="page" id="main"><h1 className="display small">Library</h1><LibraryEmpty />{connect}</main>
          : <><Library {...shared} /><div className="page">{connect}</div></>;
      case 'mixes':
        if (route.tab === 'mine') return data.mix.length ? <MyMixes {...shared} /> : <MyMixesEmpty connected={connected} />;
        return (status?.counts.ready ?? 0) > 0 ? <Mixes {...shared} /> : <MixesEmpty connected={connected} />;
      case 'listen':
        return (
          <>
            {refusal && <div className="page"><CannotPlayHere reason={refusal} /></div>}
            {data.mix.length ? <Now {...shared} /> : <ListenEmpty connected={connected} />}
            {on('cloud.local_media') && data.mix.length > 0 && <div className="page"><QueueSources mix={data.mix} book={book} /></div>}
          </>
        );
      case 'missing':
        return <OnlyOnYourComputer title="That page" nearest={{ label: 'Library', path: '/library' }} />;
      default: {
        const nearest = DESTINATIONS.find((place) => place.id === destinationOf(route) && place.id !== 'workspace') ?? DESTINATIONS.find((place) => place.id === 'library')!;
        return <OnlyOnYourComputer title={describeRoute(route).title} nearest={{ label: nearest.label, path: nearest.path }} />;
      }
    }
  };

  return (
    <RequestContext.Provider value={request}>
    <BytesContext.Provider value={noBytesHere}>
      <Shell
        route={route}
        player={player}
        now={now}
        song={song}
        showPlayer={route.page !== 'listen' && !!song && now.phase !== 'idle'}
        hasMix={data.mix.length > 0}
        hasNext={data.mix.length > now.position + 1}
        stage={false}
        waitingRequests={0}
        onRequests={IDLE}
        onHelp={IDLE}
        mode="cloud"
        more={moreItems}
        banner={<>{isHostedAccount(account) && <CutoverNotice accountId={account.user.id} />}{feedback}</>}
      >
        {page()}
      </Shell>
    </BytesContext.Provider>
    </RequestContext.Provider>
  );
}

/** More > This device: the music connected here and the storage it uses (workspace extras). */
function ThisDevice({ openStore, children }: { openStore: () => Promise<MediaStore>; children: ReactNode }) {
  const [space, setSpace] = useState<StorageSpace | null>(null);
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    let live = true;
    void storageSpace().then((found) => { if (live) setSpace(found); });
    void openStore().then((opened) => { if (live) setDegraded(opened.degraded); }).catch(() => undefined);
    return () => { live = false; };
  }, [openStore]);
  const megabytes = (bytes?: number) => (bytes === undefined ? '?' : `${(bytes / 1_000_000).toFixed(1)} MB`);
  return (
    <main className="page" id="main">
      <h1 className="display small">This device</h1>
      <section className="panel stack" aria-labelledby="this-device-storage">
        <h2 id="this-device-storage">Browser storage</h2>
        {space === null && <p className="hint">Checking…</p>}
        {space && !space.supported && <p>{space.reason}</p>}
        {space?.supported && <p>{`SelectaDJ is using ${megabytes(space.usage)} of the ${megabytes(space.quota)} this browser allows.`} {space.persisted ? 'The browser has promised to keep it.' : 'The browser may clear it if the device runs short of space; your music files are never touched.'}</p>}
        {degraded && <p role="note">This browser is not keeping SelectaDJ’s list of connected files, so you will need to connect them again next visit.</p>}
      </section>
      {children}
    </main>
  );
}
