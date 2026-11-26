import { Suspense, type ComponentProps, type ReactNode } from 'react';
import { lazyPage as lazy } from '../ui/staleBuild';
import type { MixData, Request, Status } from '../api';
import type { FlagId } from '../flags';
import type { MediaResolver, MediaStore, SourceBook } from '../media';
import type { NowState } from '../player';
import { describeRoute, destinationOf, DESTINATIONS, type MoreDestination, type MoreDestinationId, type ShellRoute } from '../shell/manifest';
import { Skeleton } from '../ui/controls';
import { Links } from '../views/Links';
import { Mix } from '../views/Mix';
import { Mixes } from '../views/Mixes';
import { MyMixes } from '../views/MyMixes';
import { Now } from '../views/Now';
import { CurrentMix } from '../views/CurrentMix';
import { LucyCloudSettings } from '../views/LucyCloudSettings';
import type { ViewProps } from '../views/shared';
import { RemoteListen } from '../devices/RemoteListen';
import { ControllerListen } from '../devices/ControllerListen';
import type { useHoldings } from '../devices/useHoldings';
import type { usePlayOn } from '../devices/playOn';
import type { useRemote } from '../devices/useRemote';
import type { useWhereToPlay } from '../devices/useWhereToPlay';
import { NOTHING_PLAYABLE_NOTICE } from '../engine/scheduler';
import { runningTime } from '../lib';
import type { Api } from './api';
import { CloudLibrary } from './CloudLibrary';
import { CloudWorkspace } from './CloudWorkspace';
import { UploadEverything } from './uploadEntry';
import { CannotPlayHere, ListenEmpty, MixesEmpty, NotOnThisAccount, OnlyOnYourComputer, PageNotFound } from './DeviceMusicEmpty';
import type { useLocalFirstPlayer } from './deviceMusicPlayer';
import { BROWSER_MIX_NEEDS } from './deviceMusicMixes';
import { EMPTY_MIX, type mediaRequest } from './deviceMusicRequest';
import { MixProblem, StatusProblem, ThisDevice } from './deviceMusicParts';
import { StemsCard } from './stems/StemsCard';
import type { useStemsEngine } from './stems/useStemsEngine';
import type { RecipeStore } from './recipeStore';
import { SavedBrowserMixes } from './SavedBrowserMixes';
import { SoundCheck } from './SoundCheck';
import { QueueSources } from './QueueSources';
import { ListenQueue } from './ListenQueue';
import { OnboardingSpine } from './onboarding/OnboardingSpine';
import { onboardingFinished } from './onboarding/state';
import type { useImportShellView } from './importSession';
import { BrowserHarmonicMatches } from './BrowserHarmonicMatches';
import { HostedMakeAMix } from './hosted/HostedMakeAMix';
import { flagListed } from '../flags';
import { ExportElsewhere } from '../views/exportElsewhere';
import { cloudFileOn } from './cloudFileExport';
import { CloudFileOffer } from './CloudFileOffer';
import { TransitionsGettingReady } from './TransitionsGettingReady';
import { accountMixesOn } from './accountMixes';
import { AccountDraftEditor, accountDraftActions } from './AccountDrafts';

// Lucy loads only when someone opens her, as in local mode, so she costs the shell nothing.
const Lucy = lazy(() => import('../views/Lucy'));
const ListeningRoom = lazy(() => import('../listening-room/ListeningRoom')); // tools.listening_room

type Player = ReturnType<typeof useLocalFirstPlayer>;

/** Everything CloudShell knows that its pages draw from, handed over in one object. */
export type CloudShellPagesContext = {
  api: Api;
  cloud: Request;
  request: Request;
  media: ReturnType<typeof mediaRequest>;
  workspaceId: string;
  on: (id: FlagId) => boolean;
  route: ShellRoute;
  moreItems: MoreDestination[];
  more: (id: MoreDestinationId) => ReactNode;
  shared: ViewProps | null;
  status: Status | null;
  statusProblem: string;
  setStatusProblem: (words: string) => void;
  refreshStatus: () => void;
  refreshMix: () => void;
  data: MixData;
  mixProblem: boolean;
  setMixData: (next: MixData) => void;
  shellPlayer: Player['player'];
  now: NowState;
  playback: Player['device'];
  refusal: Player['refusal'];
  output: Player['output'];
  notify: ViewProps['notify'];
  openStore: () => Promise<MediaStore>;
  connect: ReactNode;
  sweepLapsed: (force?: boolean) => Promise<void>;
  stems: ReturnType<typeof useStemsEngine>;
  recipes: RecipeStore;
  deviceTrack: MediaResolver;
  book: SourceBook;
  lucyHere: boolean;
  offlineShell: boolean;
  browserHarmonic: boolean;
  workspacePage: boolean;
  coexisting: boolean;
  newMember: boolean;
  spineDeps: ComponentProps<typeof OnboardingSpine>['deps'];
  setSpine: (open: boolean) => void;
  setSpineAsked: (asked: boolean) => void;
  savedMixes: number | null;
  fileCheck: { running: boolean; at: number | null };
  connected: number;
  mixReady: number;
  localExport: ReactNode;
  importLive: ReturnType<typeof useImportShellView>;
  remote: ReturnType<typeof useRemote>;
  playWays: ComponentProps<typeof RemoteListen>['ways'];
  holdings: ReturnType<typeof useHoldings>;
  where: ReturnType<typeof useWhereToPlay>;
  followsHere: boolean;
  newest: { mix_id: string; name: string; songs: number; ids?: number[] } | null;
  songOrder: number[];
  playOn: ReturnType<typeof usePlayOn>;
};

/** The page CloudShell shows for its route. Moved out of CloudShell.tsx unchanged, so the shell
 * stays under the file-length cap; every branch draws what it drew there. */
export function CloudShellPages({ at }: { at: CloudShellPagesContext }): ReactNode {
  const { api, cloud, request, media, workspaceId, on, route, moreItems, more, shared, status, statusProblem, setStatusProblem, refreshStatus, refreshMix } = at;
  const { data, mixProblem, setMixData, shellPlayer, now, playback, refusal, output, notify, openStore, connect, sweepLapsed, stems, recipes, deviceTrack, book } = at;
  const { lucyHere, offlineShell, browserHarmonic, workspacePage, coexisting, newMember, spineDeps, setSpine, setSpineAsked, savedMixes, fileCheck, connected, mixReady, localExport, importLive } = at;
  const { remote, playWays, holdings, where, followsHere, newest, songOrder, playOn } = at;
  // cloud.one_mixer: the shared mixer for every account, and its file made in the cloud library
  const oneMixer = flagListed('cloud.one_mixer');
  const cloudFile = oneMixer && coexisting && cloudFileOn();
  // cloud.account_mixes: My Mixes lists the account's drafts and the editor opens one (AccountDrafts.tsx)
  const drafts = accountMixesOn() ? accountDraftActions({ request, setMixData, refreshStatus, player: shellPlayer, notify }) : null;
  // ADR-0476: Lucy reads the account's API herself, so she opens at once, never behind the
  // catalogue's first load (2,919 songs took about 30 s on staging)
  if (route.page === 'lucy' && lucyHere) return <Suspense fallback={<Skeleton lines={4} label="Opening Lucy" />}><Lucy conversation={route.conversation} setMixData={setMixData} player={shellPlayer} request={request} usageRequest={cloud} settingsPanel={<LucyCloudSettings request={cloud} />} /></Suspense>;
  if (route.page === 'more') {
    const item = moreItems.find((place) => place.id === route.id);
    if (!item) return <NotOnThisAccount />;
    if (item.id === 'workspace') return <ThisDevice openStore={openStore}>{connect}<StemsCard enabled={stems.enabled} store={stems.store} /></ThisDevice>;
    if (item.id === 'listening_room') return <Suspense fallback={<Skeleton lines={4} label="Opening the Listening Room" />}><ListeningRoom workspaceId={workspaceId} mix={data.mix} mixName={data.name} mixId={recipes.current() ?? null} loading={data === EMPTY_MIX && !mixProblem} resolve={deviceTrack} shellPlaying={now.phase === 'playing' && (playback.view?.speaker === 'here' || !on('devices.remote_control'))} pauseShell={() => shellPlayer.togglePause()} /></Suspense>;
    return <main className="page" id="main" data-place={item.id}><h1 className="display small">{item.label}</h1><div className="stack">{more(item.id)}</div></main>;
  }
  if (!shared) {
    return <main className="page" id="main" aria-busy={!statusProblem}><h1 className="display small">{describeRoute(route).title}</h1>{statusProblem ? (offlineShell ? <StatusProblem words={statusProblem} onRetry={() => { setStatusProblem(''); refreshStatus(); refreshMix(); }} /> : <p role="alert">{statusProblem}</p>) : <Skeleton variant="rows" lines={4} label="Opening your library" />}</main>;
  }
  if (newMember) {
    return (
      <main className="page" id="main" data-page-width="reading">
        <h1 className="display small">Welcome to SelectaDJ</h1>
        <OnboardingSpine request={media} workspaceId={workspaceId} deps={spineDeps} onDone={() => { setSpine(false); setSpineAsked(false); refreshStatus(); }} />
      </main>
    );
  }
  // Make a Mix > Harmonic matches, from key profiles measured on this device
  if (route.page === 'discover' && route.tab === 'harmonic' && browserHarmonic && on('discover.harmonic')) return <BrowserHarmonicMatches resolveTrack={deviceTrack} />;
  // Workspace, with the tabs a browser can fill (cloud.workspace)
  if (route.page === 'workshop' && workspacePage) {
    return (
      <CloudWorkspace
        tab={route.tab}
        status={shared.status}
        workspaceId={workspaceId}
        openStore={openStore}
        connect={connect}
        stems={<StemsCard enabled={stems.enabled} store={stems.store} />}
        stemsShown={stems.enabled && !!stems.store}
        measuringKeys={browserHarmonic && on('discover.harmonic')}
        savedMixes={savedMixes}
        fileCheck={fileCheck}
        playback={{ refusal, speaker: playback.view?.speaker ?? null, phase: now.phase }}
        // cloud.move_to_cloud: draws nothing while the flag is off or no upload queue can run
        uploadAll={on('cloud.move_to_cloud') ? <UploadEverything request={media} openStore={openStore} songsHere={shared.status.counts.ready ?? null} /> : undefined}
      />
    );
  }
  switch (route.page) {
    case 'library':
      // I84: on a remote, the Library's Play next follows the speaker's music, not this device's
      return <CloudLibrary shared={remote ? { ...shared, now: remote.now } : shared} connected={connected} cloudStorage={coexisting} connect={{ request: media, workspaceId, openStore, onAvailabilityChanged: () => sweepLapsed(true) }} />;
    case 'mixes':
      if (route.tab === 'mine' && drafts) return <><MyMixes {...shared} {...drafts} />{localExport}</>;
      if (route.tab === 'mine') return <><MyMixes {...shared} suppressDrafts>{on('drafts') && <SavedBrowserMixes workspaceId={workspaceId} recipes={recipes} request={request} setMixData={setMixData} refreshStatus={refreshStatus} player={shellPlayer} notify={notify} phase={playback.view?.speaker === 'here' || !on('devices.remote_control') ? now.phase : 'idle'} currentSeconds={runningTime(data.mix)} />}</MyMixes>{localExport}</>;
      // R8: a device with little music mixes the songs R1's device holds; hosted: HostedMakeAMix.tsx
      { const mixer = mixReady >= BROWSER_MIX_NEEDS ? <Mixes {...shared} status={{ ...shared.status, counts: { ...shared.status.counts, ready: mixReady } }} /> : (
        <MixesEmpty
          current={data.mix.length > 0 ? <CurrentMix mix={data.mix} mixName={data.name} now={now} player={shellPlayer} setView={shared.setView} analysisAvailable={false} /> : undefined}
          connected={connected}
          onSetUp={onboardingFinished(workspaceId) ? undefined : () => { setSpineAsked(true); setSpine(true); }}
          checking={importLive.phase === 'running' ? { checked: importLive.registered, total: importLive.total } : undefined}
        />
      );
      // cloud.one_mixer: the shared mixer for every account; the old card only with it off
      return <>{coexisting && on('cloud.hosted_render') && !oneMixer ? <HostedMakeAMix api={api} workspaceId={workspaceId} browserMixer={mixer} othersPlaying={now.phase === 'playing'} stopOthers={() => { if (now.phase === 'playing') void shellPlayer.togglePause(); }} /> : mixer}{localExport}</>; }
    case 'listen':
      // something is playing on another device and this one does not hold that mix: the remote
      if (remote) return <RemoteListen remote={remote} playableHere={status?.counts.ready ?? 0} ways={playWays} refusal={playback.error} speakerSongs={holdings.speakerSongs} notice={where.notice} onDismissNotice={where.clearNotice} />;
      // nothing is playing (no speaker at all) and this device holds no music, but the person
      // has another device: play on one that has music (ADR-0475 R1, R2), or say which is
      // missing; never a Play button that cannot work here
      if (on('devices.remote_control') && !followsHere && status && holdings.devices && holdings.devices.some((device) => device.device_id !== playback.device?.id)) {
        return (
          <ControllerListen
            mixName={data.mix.length ? data.name : newest?.name ?? ''} mixSongs={data.mix.length || (newest?.songs ?? 0)} devices={holdings.devices} thisDeviceId={playback.device?.id ?? null}
            mixIds={data.mix.length ? songOrder : newest?.ids ?? []} ids={holdings.ids}
            now={playback.serverNow()} asking={playOn.state}
            onPlayOn={(device) => void playOn.ask(device, recipes.current() ?? newest?.mix_id ?? null)} notice={where.notice} onDismissNotice={where.clearNotice} hosted={coexisting && on('cloud.hosted_render')}
          />
        );
      }
      return (
        <>
          {refusal && <div className="page"><CannotPlayHere reason={refusal} /></div>}
          {data.mix.length ? <Now {...shared} listenQueue={<>{oneMixer && <TransitionsGettingReady workspaceId={workspaceId} />}<ListenQueue mix={data.mix} now={now} player={shellPlayer} /></>} noticeAction={<>{output?.state === 'output_unverified' && <SoundCheck />}{on('cloud.local_media') && <QueueSources mix={data.mix} book={book} problemsOnly={!coexisting} nothingPlays={now.notice === NOTHING_PLAYABLE_NOTICE} />}</>} /> : mixProblem ? <MixProblem onRetry={refreshMix} /> : <ListenEmpty connected={connected} playable={status?.counts.ready ?? 0} saved={savedMixes} />}
        </>
      );
    case 'edit':
      // The account's drafts have an editor of their own; saved browser mixes are opened as the
      // current mix from My Mixes, so with account mixes off only the current mix has one here.
      if (route.draft !== null && drafts) return <AccountDraftEditor draftId={route.draft} shared={shared} request={request} actions={drafts} />;
      if (route.draft !== null) return <OnlyOnYourComputer title="Editing a saved draft" nearest={{ label: 'My Mixes', path: '/mixes/mine' }} />;
      if (mixProblem && !data.mix.length) return <MixProblem onRetry={refreshMix} />;
      // cloud.one_mixer: the Export panel may also make the file in the cloud library
      return <ExportElsewhere.Provider value={cloudFile ? CloudFileOffer : null}><Mix {...shared} {...(drafts ?? {})} key="current" /></ExportElsewhere.Provider>;
    case 'missing':
      return <PageNotFound />;
    case 'discover':
      // Word connections are answered in the browser (deviceMusicLinks.ts) while
      // discover.word_links is on for the account; with it off this page is as it was
      if (route.tab === 'words' && on('discover.word_links')) return <Links {...shared} tab="words" />;
      // falls through
    default: {
      const nearest = DESTINATIONS.find((place) => place.id === destinationOf(route) && place.id !== 'workspace') ?? DESTINATIONS.find((place) => place.id === 'library')!;
      return <OnlyOnYourComputer title={describeRoute(route).title} nearest={{ label: nearest.label, path: nearest.path }} />;
    }
  }
}
