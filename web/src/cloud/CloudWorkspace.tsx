import { cloneElement, isValidElement, ReactElement, ReactNode, Ref, useEffect, useRef, useState } from 'react';
import type { Status as AppStatus } from '../api';
import { useFlags } from '../flags';
import { forgetFolder, recallFolder, storageSpace, type MediaStore, type StorageSpace, type StoredFolderHandle } from '../media';
import type { WorkshopTab } from '../router';
import { PageLink } from '../shell/PageLink';
import { Action, Skeleton, Status } from '../ui/controls';
import { Icon, type IconName } from '../ui/Icon';
import { LinkTabs } from '../ui/primitives';
import { InterfaceChoices } from '../views/InterfaceChoices';
import { BrowserDiagnostics, type PlaybackFacts } from './BrowserDiagnostics';
import { DeviceDataCard } from './DeviceDataCard';
import { summaryWords, type ConnectMusicHandle } from './ConnectMusic';
import { checkedWords, formatCount } from './ImportStatus';
import { useImportSession } from './importSession';
import { useResumeOffer } from './importResume';
import { bytes } from './api';
import { OnlyOnYourComputer } from './LocalFirstEmpty';
import { readPersistState, subscribePersist, type PersistState } from './persistence';
import { StorageCard } from './StorageCard';
import './libraryWorkspace.css';

/** Workspace in browser-first Cloud (`cloud.workspace`).
 *
 * Local mode's Workspace is this computer's server: analysis, folders on disk, learning and the
 * server's diagnostics. A browser has none of that, so this page keeps only the tabs it can fill
 * truthfully: what the library holds and what needs the member, how music is connected here, this
 * browser's storage, and what this browser can do. Analysis and Learning are not tabs here at all;
 * their addresses say they belong to SelectaDJ on a computer.
 */

const TABS: { tab: WorkshopTab; label: string; path: string }[] = [
  { tab: 'overview', label: 'Overview', path: '/workshop' },
  { tab: 'sources', label: 'Sources', path: '/workshop/sources' },
  { tab: 'storage', label: 'Storage', path: '/workshop/storage' },
  { tab: 'diagnostics', label: 'Diagnostics', path: '/workshop/diagnostics' },
];

const SUBS: Partial<Record<WorkshopTab, string>> = {
  overview: 'Your music at a glance, and anything that needs you.',
  sources: 'Where your music comes from on this device.',
  storage: 'What SelectaDJ keeps in this browser.',
  diagnostics: 'Whether this browser can do everything SelectaDJ needs.',
};

export type FileCheck = { running: boolean; at: number | null };
export type { PlaybackFacts };

/** The shell's Connect music, drawn here in another form and reachable from this page's buttons. */
function connectAs(connect: ReactNode, variant: 'card' | 'status', ref: Ref<ConnectMusicHandle>): ReactNode {
  return isValidElement(connect) ? cloneElement(connect as ReactElement<{ variant?: string; ref?: Ref<ConnectMusicHandle> }>, { variant, ref }) : connect;
}

export function CloudWorkspace({ tab, status, workspaceId, openStore, connect, stems, stemsShown, measuringKeys, savedMixes, fileCheck, playback }: {
  tab: WorkshopTab;
  status: AppStatus;
  workspaceId: string;
  openStore: () => Promise<MediaStore>;
  /** Connect music, drawn by the shell with its own importer and store. */
  connect: ReactNode;
  /** The stem splitter's card (cloud.browser_stems), or nothing. */
  stems: ReactNode;
  stemsShown: boolean;
  /** Whether this browser measures songs' keys in spare time for Harmonic matches (cloud.browser_harmonic). */
  measuringKeys: boolean;
  /** How many mixes the account has saved, or null before the server has said. */
  savedMixes: number | null;
  /** The sweep that checks which connected files this browser can still open. */
  fileCheck: FileCheck;
  playback: PlaybackFacts;
}) {
  const on = useFlags();
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    let live = true;
    void openStore().then((opened) => { if (live) setDegraded(opened.degraded); }).catch(() => undefined);
    return () => { live = false; };
  }, [openStore]);

  if (tab === 'analysis' || tab === 'learning') {
    return <OnlyOnYourComputer title={tab === 'analysis' ? 'Analysis' : 'Learning'} nearest={{ label: 'Workspace', path: '/workshop' }} />;
  }
  const here = TABS.find((item) => item.tab === tab)?.path ?? '/workshop';
  return (
    <main className="page browse workspace lw-workspace" id="main">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="display small">Workspace</h1>
          <p className="page-lead">{SUBS[tab]}</p>
        </div>
        {tab !== 'sources' && <div className="page-header-actions"><PageLink to="/workshop/sources" className={`button${tab === 'overview' ? ' primary' : ''}`}><Icon name="plus" size="toolbar" />Connect music</PageLink></div>}
      </header>
      <LinkTabs label="Workspace" items={TABS} current={here} />
      {tab === 'overview' && <Overview status={status} workspaceId={workspaceId} connect={connect} degraded={degraded} savedMixes={savedMixes} fileCheck={fileCheck} stemsShown={stemsShown} measuringKeys={measuringKeys} />}
      {tab === 'sources' && <Sources status={status} workspaceId={workspaceId} connect={connect} />}
      {tab === 'storage' && (
        <div className="lw-stack">
          <StorageCard degraded={degraded} />
          {stems}
          {on('cloud.local_media') && <DeviceDataCard workspaceId={workspaceId} onCleared={() => window.location.reload()} />}
        </div>
      )}
      {tab === 'diagnostics' && <div className="lw-stack"><BrowserDiagnostics openStore={openStore} playback={playback} /></div>}
    </main>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function Tile({ to, label, value, detail }: { to: string; label: string; value: ReactNode; detail?: string }) {
  return (
    <PageLink to={to} className="lw-tile">
      <span className="lw-tile-label">{label}</span>
      <strong>{value ?? <i className="lw-tile-wait" aria-label="Loading" />}</strong>
      <span className="lw-tile-detail">{detail}</span>
    </PageLink>
  );
}

type Need = { key: string; icon: IconName; title: string; words: string; action: ReactNode };

function Overview({ status, workspaceId, connect, degraded, savedMixes, fileCheck, stemsShown, measuringKeys }: {
  status: AppStatus;
  workspaceId: string;
  connect: ReactNode;
  degraded: boolean;
  savedMixes: number | null;
  fileCheck: FileCheck;
  stemsShown: boolean;
  measuringKeys: boolean;
}) {
  const { counts } = status;
  const importing = useImportSession(workspaceId);
  const interrupted = useResumeOffer(workspaceId);
  const handle = useRef<ConnectMusicHandle>(null);
  const [space, setSpace] = useState<StorageSpace | null>(null);
  const [persist, setPersist] = useState<PersistState | null>(null);
  useEffect(() => {
    let live = true;
    void storageSpace().then((found) => { if (live) setSpace(found); }, () => undefined);
    void readPersistState().then((found) => { if (live) setPersist(found); }, () => undefined);
    const stop = subscribePersist((answer) => { if (live) setPersist(answer); });
    return () => { live = false; stop(); };
  }, []);
  const songs = counts.music ?? 0;
  const playable = counts.ready ?? 0;
  const missing = counts.missing ?? 0;
  const running = importing.phase === 'running';

  const needs: Need[] = [];
  if (songs === 0 && !running) {
    needs.push({ key: 'empty', icon: 'music', title: 'Add your music', words: 'Choose the folder your songs are in. Your files stay on this device.', action: <button type="button" className="primary" onClick={() => handle.current?.chooseFolder()}>Choose a folder</button> });
  } else if (playable < songs - missing && !running && !interrupted) {
    needs.push({
      key: 'choose', icon: 'folder',
      title: playable === 0 ? 'Your songs are not open in this browser yet' : `${formatCount(songs - missing - playable)} songs are not open in this browser`,
      words: 'Choose your folder again to play them here. Songs on your other devices stay listed.',
      action: <button type="button" onClick={() => handle.current?.chooseFolder()}>Choose your folder again</button>,
    });
  }
  if (missing > 0) {
    needs.push({ key: 'missing', icon: 'warning', title: `${formatCount(missing)} ${missing === 1 ? 'song is' : 'songs are'} missing from every device`, words: 'Connect the folder they are in to bring them back.', action: <PageLink to="/library?show=attention" className="button">Show them</PageLink> });
  }
  if (degraded) {
    needs.push({ key: 'degraded', icon: 'warning', title: 'This browser is not keeping your song list', words: 'You will need to choose your songs again next visit. A private window often causes this.', action: <PageLink to="/workshop/diagnostics" className="button">See why</PageLink> });
  } else if (songs > 0 && (persist === 'not_granted' || persist === 'refused')) {
    needs.push({ key: 'persist', icon: 'lock', title: 'The browser may clear SelectaDJ’s details', words: 'If this device runs short of space. Your music files are never affected.', action: <PageLink to="/workshop/storage" className="button">Review storage</PageLink> });
  }

  const activity: ReactNode[] = [];
  if ((importing.phase === 'finished' || importing.phase === 'paused') && importing.summary) {
    activity.push(<Status key="import" kind={importing.phase === 'paused' ? 'paused' : 'ready'}>{`Last added: ${summaryWords(importing.summary)}`}</Status>);
  }
  if (running) activity.push(<Status key="running" kind="working">{`Adding your music: ${checkedWords(importing)}.`}</Status>);
  activity.push(fileCheck.running
    ? <Status key="check" kind="working">Checking which songs can play here.</Status>
    : fileCheck.at
      ? <Status key="check" kind="ready">{`Songs checked at ${clock(fileCheck.at)}.`}</Status>
      : <Status key="check" kind="queued">Songs not checked yet this visit.</Status>);
  if (measuringKeys) activity.push(<Status key="keys" kind="working">Measuring song keys for Harmonic matches.</Status>);

  return (
    <div className="lw-stack">
      <div className="lw-tiles">
        <Tile to="/library" label="Songs" value={formatCount(songs)} detail="in your library" />
        <Tile to="/library?show=ready" label="Playable here" value={formatCount(playable)} detail={songs ? `of ${formatCount(songs)} in this browser` : 'in this browser'} />
        <Tile to="/workshop/storage" label="Storage used" value={space === null ? null : space.supported ? bytes(space.usage ?? 0) : 'Not known'} detail={space?.supported ? `of ${bytes(space.quota ?? 0)} allowed` : 'in this browser'} />
        <Tile to="/mixes/mine" label="Saved mixes" value={savedMixes === null ? null : formatCount(savedMixes)} detail="in My Mixes" />
      </div>
      {/* progress, an interrupted import and results show here too, and own the pickers */}
      {connectAs(connect, 'status', handle)}
      <div className="lw-columns">
        <section className="ui-card" aria-labelledby="cloud-needs-title">
          <h2 className="section-title" id="cloud-needs-title">Needs attention</h2>
          {needs.length === 0 ? (
            <p className="lw-clear"><span className="lw-clear-mark" aria-hidden="true"><Icon name="check" size="toolbar" /></span>Nothing needs you. Your music is ready.</p>
          ) : (
            <ul className="lw-needs">
              {needs.map((need) => (
                <li key={need.key}>
                  <span className="lw-need-mark" aria-hidden="true"><Icon name={need.icon} size="toolbar" /></span>
                  <div><b>{need.title}</b><span>{need.words}</span></div>
                  {need.action}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ui-card" aria-labelledby="cloud-background-title">
          <h2 className="section-title" id="cloud-background-title">Activity</h2>
          <ul className="lw-activity diagnostic-facts">
            {activity.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
          {stemsShown && <p className="hint">Stem splitting is under <PageLink to="/workshop/storage">Storage</PageLink>.</p>}
        </section>
      </div>
      <InterfaceChoices classicNav={false} />
      <p className="hint about-app lw-about">SelectaDJ is a REX Technologies product.</p>
    </div>
  );
}

/** Where music comes from in this browser: the way to add more, the folder this browser remembers,
 * and how much of the library is open here. */
function Sources({ status, workspaceId, connect }: { status: AppStatus; workspaceId: string; connect: ReactNode }) {
  const handle = useRef<ConnectMusicHandle>(null);
  const [folder, setFolder] = useState<StoredFolderHandle | null | undefined>(undefined);
  const [access, setAccess] = useState<string | null>(null);
  const live = useImportSession(workspaceId);
  // a folder chosen on this page is remembered straight away, so the list reads again as an import starts and ends
  useEffect(() => {
    let current = true;
    void recallFolder(workspaceId).then(async (found) => {
      if (!current) return;
      setFolder(found ?? null);
      try {
        const state = found?.queryPermission ? await found.queryPermission({ mode: 'read' }) : null;
        if (current) setAccess(state);
      } catch { /* the browser would not say; nothing is claimed */ }
    }, () => { if (current) setFolder(null); });
    return () => { current = false; };
  }, [workspaceId, live.phase]);
  const songs = status.counts.music ?? 0;
  const playable = status.counts.ready ?? 0;
  return (
    <div className="lw-stack">
      {connectAs(connect, 'card', handle)}
      <section className="ui-card" aria-labelledby="remembered-folder-title">
        <h2 className="section-title" id="remembered-folder-title">Connected in this browser</h2>
        {folder === undefined ? <Skeleton variant="rows" lines={2} label="Looking for your folder" /> : (
          <ul className="lw-sources">
            {folder && (
              <li>
                <span className="lw-source-mark" aria-hidden="true"><Icon name="folder" /></span>
                <div>
                  <b dir="auto">{folder.name}</b>
                  <span>{access === 'granted' ? 'Folder. This browser can read it now.' : access ? 'Folder. The browser asks your permission before reading it again.' : 'Folder remembered in this browser.'}</span>
                </div>
                <div className="lw-source-actions">
                  <button type="button" onClick={() => handle.current?.chooseFolder()}>Add new songs</button>
                  <Action className="quiet" working="Forgetting…" title="Removes nothing from your library" run={async () => { await forgetFolder(workspaceId); setFolder(null); }}>Forget</Action>
                </div>
              </li>
            )}
            {songs > 0 && (
              <li>
                <span className="lw-source-mark" aria-hidden="true"><Icon name="music" /></span>
                <div>
                  <b>{`${formatCount(playable)} of ${formatCount(songs)} songs open here`}</b>
                  <span>{playable < songs ? 'The rest are on your other devices, or need choosing again in this browser.' : 'Every song in your library can play in this browser.'}</span>
                </div>
                <div className="lw-source-actions"><PageLink to="/library" className="button">Open Library</PageLink></div>
              </li>
            )}
            {!folder && songs === 0 && (
              <li className="lw-sources-empty">
                <span className="lw-source-mark" aria-hidden="true"><Icon name="folder" /></span>
                <div><b>No music connected yet</b><span>Choose a folder above and it is remembered here.</span></div>
              </li>
            )}
          </ul>
        )}
        {folder === null && songs > 0 && <p className="hint">No folder is remembered in this browser. Choose a folder above and it is remembered, so adding music can carry on after an interruption.</p>}
      </section>
    </div>
  );
}
