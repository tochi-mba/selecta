import { cloneElement, CSSProperties, isValidElement, ReactElement, ReactNode, Ref, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Status as AppStatus } from '../api';
import { useFlag, useFlags } from '../flags';
import { forgetFolder, recallFolder, storageSpace, type ImportSummary, type MediaStore, type StorageSpace, type StoredFolderHandle } from '../media';
import type { WorkshopTab } from '../router';
import { PageLink } from '../shell/PageLink';
import { Action, Skeleton, Status } from '../ui/controls';
import { Icon, ICON_SLOTS, ICON_STROKES, type IconName } from '../ui/Icon';
import { LinkTabs } from '../ui/primitives';
import { InterfaceChoices } from '../views/InterfaceChoices';
import { BrowserDiagnostics, type PlaybackFacts } from './BrowserDiagnostics';
import { DeviceDataCard } from './DeviceDataCard';
import { summaryWords, type ConnectMusicHandle } from './ConnectMusic';
import { checkedWords, formatCount } from './ImportStatus';
import { useImportSession } from './importSession';
import { useResumeOffer } from './importResume';
import { bytes } from './api';
import { OnlyOnYourComputer } from './DeviceMusicEmpty';
import { readPersistState, subscribePersist, type PersistState } from './persistence';
import { StorageCard } from './StorageCard';
import { MusicFolders } from './MusicFolders';
import { onTonalActivity, tonalActivity, tonalActivityWords } from './tonalActivity';
import { setMeasuringPaused } from './measuringControl';
import { NumberRoll } from '../feel/numberRoll';
import { feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
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
function connectAs(connect: ReactNode, variant: 'card' | 'status', ref: Ref<ConnectMusicHandle>, status: AppStatus): ReactNode {
  const songs = status.counts.music ?? 0;
  const playable = status.counts.ready ?? 0;
  // a finished import says what it changed for this browser, once the counts have caught up
  const doneWords = (summary: ImportSummary) => (playable === 0 && summary.imported + summary.duplicates > 0
    ? summaryWords(summary)
    : `${formatCount(playable)} of ${formatCount(songs)} songs can now play here.`);
  return isValidElement(connect) ? cloneElement(connect as ReactElement<{ variant?: string; ref?: Ref<ConnectMusicHandle>; doneWords?: (summary: ImportSummary) => string }>, { variant, ref, doneWords }) : connect;
}

export function CloudWorkspace({ tab, status, workspaceId, openStore, connect, stems, stemsShown, measuringKeys, savedMixes, fileCheck, playback, uploadAll }: {
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
  /** cloud.move_to_cloud: "Upload everything on this device" (uploadEntry.tsx), drawn by the
   * shell, or nothing; Sources shows it under the songs open here. */
  uploadAll?: ReactNode;
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
        {tab !== 'sources' && <div className="page-header-actions"><PageLink to="/workshop/sources" className="button"><Icon name="plus" size="toolbar" />Connect music</PageLink></div>}
      </header>
      <LinkTabs label="Workspace" items={TABS} current={here} />
      {tab === 'overview' && <Overview status={status} workspaceId={workspaceId} connect={connect} degraded={degraded} savedMixes={savedMixes} fileCheck={fileCheck} stemsShown={stemsShown} measuringKeys={measuringKeys} />}
      {tab === 'sources' && <Sources status={status} workspaceId={workspaceId} connect={connect} uploadAll={uploadAll} />}
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
    <PageLink to={to} className="lw-tile" data-lift="" data-glow="">
      <span className="lw-tile-label">{label}</span>
      <strong>{value ?? <i className="lw-tile-wait" aria-label="Loading" />}</strong>
      <span className="lw-tile-detail">{detail}</span>
    </PageLink>
  );
}

type Need = { key: string; icon: IconName; title: string; words: string; action: ReactNode };

/** The needs that were just fixed, kept on screen while they fold away (.feel-collapse-out), so a
 * fixed row visibly leaves instead of vanishing. Only with the feel's motion on; otherwise a fixed
 * row goes at once, exactly as before. A leaving row is inert and hidden from assistive technology,
 * because it is no longer something to do. */
function useFixedNeeds(needs: Need[]) {
  const [fixed, setFixed] = useState<Need[]>([]);
  const before = useRef<Need[]>(needs);
  const signature = needs.map((need) => need.key).join('|');
  useEffect(() => {
    const was = before.current;
    before.current = needs;
    if (!feelOn('motion')) return;
    const still = new Set(needs.map((need) => need.key));
    const left = was.filter((need) => !still.has(need.key));
    if (left.length === 0) return;
    const leaving = new Set(left.map((need) => need.key));
    setFixed((list) => [...list.filter((need) => !still.has(need.key) && !leaving.has(need.key)), ...left]);
    // the fallback for when no animationend arrives (calm, or the row was hidden)
    const timer = window.setTimeout(() => setFixed((list) => list.filter((need) => !leaving.has(need.key))), motionMs('--motion-handoff', 400) + 120);
    return () => window.clearTimeout(timer);
    // the keys say whether anything changed; the list itself is rebuilt on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const gone = (key: string) => setFixed((list) => list.filter((need) => need.key !== key));
  return { fixed: fixed.filter((need) => !needs.some((now) => now.key === need.key)), gone };
}

/** The needs that came up after the page was first drawn, so each can glow once (.feel-flash)
 * as it arrives. Those already there when the page opened are simply shown. */
function useFreshNeeds(needs: Need[]) {
  const first = useRef<Set<string> | null>(null);
  if (first.current === null) first.current = new Set(needs.map((need) => need.key));
  const known = first.current;
  return new Set(feelOn('motion') ? needs.map((need) => need.key).filter((key) => !known.has(key)) : []);
}

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
  const keysNow = useSyncExternalStore(onTonalActivity, tonalActivity, tonalActivity);
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
      title: playable === 0 ? 'This browser hasn’t been given your music yet' : playable * 5 < songs ? `Only ${formatCount(playable)} of ${formatCount(songs)} songs can play in this browser` : `${formatCount(songs - missing - playable)} songs are not open in this browser`,
      words: playable * 5 < songs ? 'Each browser needs the folder once. Your library, mixes and settings are already here.' : 'Choose your music folder to play them here.',
      action: <button type="button" className={playable * 5 < songs ? 'primary' : undefined} onClick={() => handle.current?.chooseFolder()}>Choose your music folder</button>,
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

  const { fixed, gone } = useFixedNeeds(needs);
  const fresh = useFreshNeeds(needs);

  // Each line is keyed by what it says is happening, so a line whose state really changed (an import
  // that finished, a check that started) is a new line and arrives (data-arrive) while the rest stay.
  const activity: { key: string; line: ReactNode }[] = [];
  if ((importing.phase === 'finished' || importing.phase === 'paused') && importing.summary) {
    activity.push({ key: `import-${importing.phase}`, line: <Status kind={importing.phase === 'paused' ? 'paused' : 'ready'}>{`Last added: ${summaryWords(importing.summary)}`}</Status> });
  }
  if (running) activity.push({ key: 'running', line: <Status kind="working">{`Adding your music: ${checkedWords(importing)}.`}</Status> });
  activity.push(fileCheck.running
    ? { key: 'check-running', line: <Status kind="working">Checking which songs can play here.</Status> }
    : fileCheck.at
      ? { key: `check-${fileCheck.at}`, line: <Status kind="ready">{`Songs checked at ${clock(fileCheck.at)}.`}</Status> }
      : { key: 'check-waiting', line: <Status kind="queued">Songs are checked in the background while SelectaDJ is open.</Status> });
  // what the profiler is really doing in this tab: nothing is said once every song is measured
  const keysWords = measuringKeys ? tonalActivityWords(keysNow) : null;
  // the Desktop's stop and start of analysis: a pause lasts until the member carries on
  const pauseControl = measuringKeys && (keysNow === 'measuring' || keysNow === 'paused')
    ? <button type="button" className="link" onClick={() => setMeasuringPaused(keysNow !== 'paused')}>{keysNow === 'paused' ? 'Carry on measuring' : 'Pause measuring'}</button>
    : null;
  if (keysWords) activity.push({ key: `keys-${keysNow}`, line: <><Status kind={keysNow === 'measuring' ? 'working' : 'paused'}>{keysWords}</Status>{pauseControl && <> {pauseControl}</>}</> });

  return (
    <div className="lw-stack">
      <div className="lw-tiles">
        {/* the figures roll to their values; the words read out are the same as before */}
        <Tile to="/library" label="Songs" value={<NumberRoll value={songs} format={formatCount} />} detail="in your library" />
        <Tile to="/library?show=ready" label="Playable here" value={<NumberRoll value={playable} format={formatCount} />} detail={songs ? `of ${formatCount(songs)} in this browser` : 'in this browser'} />
        <Tile to="/workshop/storage" label="Storage used" value={space === null ? null : space.supported ? <NumberRoll value={space.usage ?? 0} format={bytes} /> : 'Not known'} detail={space?.supported ? `of ${bytes(space.quota ?? 0)} allowed` : 'in this browser'} />
        <Tile to="/mixes/mine" label="Saved mixes" value={savedMixes === null ? null : <NumberRoll value={savedMixes} format={formatCount} />} detail="in My Mixes" />
      </div>
      {/* progress, an interrupted import and results show here too, and own the pickers */}
      {connectAs(connect, 'status', handle, status)}
      <div className="lw-columns">
        <section className="ui-card" aria-labelledby="cloud-needs-title">
          <h2 className="section-title" id="cloud-needs-title">Needs attention</h2>
          {needs.length === 0 && fixed.length === 0 ? (
            <p className="lw-clear"><span className="lw-clear-mark" aria-hidden="true"><Icon name="check" size="toolbar" /></span>Nothing needs you. Your music is ready.</p>
          ) : (
            <ul className="lw-needs" data-stagger="">
              {needs.map((need, index) => (
                // a need that came up while the page was open glows once, after it arrives
                <li key={need.key} className={fresh.has(need.key) ? 'feel-flash' : undefined} style={{ '--i': index } as CSSProperties}>
                  <span className="lw-need-mark" aria-hidden="true"><Icon name={need.icon} size="toolbar" /></span>
                  <div><b>{need.title}</b><span>{need.words}</span></div>
                  {need.action}
                </li>
              ))}
              {fixed.map((need) => (
                <li key={need.key} className="feel-collapse-out" aria-hidden="true" inert onAnimationEnd={(event) => { if (event.target === event.currentTarget) gone(need.key); }}>
                  {/* fixed: the mark becomes a tick that draws itself as the row folds away */}
                  <span className="lw-need-mark" aria-hidden="true">
                    <svg className="ui-icon" data-icon="check" data-size="toolbar" viewBox="0 0 24 24" width={ICON_SLOTS.toolbar} height={ICON_SLOTS.toolbar} fill="none" stroke="currentColor" strokeWidth={ICON_STROKES.toolbar} strokeLinecap="round" strokeLinejoin="round" focusable="false">
                      <path className="feel-tick" pathLength={1} d="m5 12 4 4L19 6" />
                    </svg>
                  </span>
                  <div><b>{need.title}</b><span>{need.words}</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ui-card" aria-labelledby="cloud-background-title">
          <h2 className="section-title" id="cloud-background-title">Activity</h2>
          <ul className="lw-activity diagnostic-facts">
            {activity.map(({ key, line }) => <li key={key} data-arrive="">{line}</li>)}
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
function Sources({ status, workspaceId, connect, uploadAll }: { status: AppStatus; workspaceId: string; connect: ReactNode; uploadAll?: ReactNode }) {
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
  const watching = useFlag('cloud.music_folders');
  const openHere = songs > 0 && (
    <li>
      <span className="lw-source-mark" aria-hidden="true"><Icon name="music" /></span>
      <div>
        <b>{`${formatCount(playable)} of ${formatCount(songs)} songs open here`}</b>
        <span>{playable < songs ? 'The rest are on your other devices, or need choosing again in this browser.' : 'Every song in your library can play in this browser.'}</span>
      </div>
      <div className="lw-source-actions"><PageLink to="/library" className="button">Open Library</PageLink></div>
    </li>
  );
  if (watching) {
    // cloud.music_folders: Your music folders is how music is connected here; Connect music keeps
    // its progress, results and pickers above it
    return (
      <div className="lw-stack">
        {connectAs(connect, 'status', handle, status)}
        <MusicFolders workspaceId={workspaceId} variant="full" onAddFolder={() => handle.current?.chooseFolder()} onChooseSongs={() => handle.current?.chooseSongs()} />
        {openHere && <section className="ui-card" aria-label="Songs open here"><ul className="lw-sources">{openHere}</ul></section>}
        {uploadAll}
      </div>
    );
  }
  return (
    <div className="lw-stack">
      {connectAs(connect, 'card', handle, status)}
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
            {openHere}
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
      {uploadAll}
    </div>
  );
}
