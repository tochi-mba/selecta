import { ReactNode, useCallback, useEffect, useState } from 'react';
import type { Status as AppStatus } from '../api';
import { FLAG_IDS, flagOn, useFlags } from '../flags';
import { forgetFolder, recallFolder, storageSpace, type MediaStore, type StorageSpace, type StoredFolderHandle } from '../media';
import { ENGINE_VERSION, probeCapability, type ProbeResult } from '../engine/probe';
import type { WorkshopTab } from '../router';
import { Action, Skeleton, Status, type StatusKind } from '../ui/controls';
import { countOf } from '../ui/format';
import { LinkTabs } from '../ui/primitives';
import { InterfaceChoices } from '../views/InterfaceChoices';
import { DeviceDataCard } from './DeviceDataCard';
import { summaryWords } from './ConnectMusic';
import { useImportSession } from './importSession';
import { OnlyOnYourComputer } from './LocalFirstEmpty';
import { readPersistState, type PersistState } from './persistence';
import { StorageCard } from './StorageCard';

/** Workspace in browser-first Cloud (`cloud.workspace`).
 *
 * Local mode's Workspace is this computer's server: analysis, folders on disk, learning and the
 * server's diagnostics. A browser has none of that, so this page keeps only the tabs it can fill
 * truthfully: what the library holds and what this browser is doing in the background, how music
 * is connected here, this browser's storage, and what this browser can do. Analysis and Learning
 * are not tabs here at all; their addresses say they belong to SelectaDJ on a computer.
 */

const TABS: { tab: WorkshopTab; label: string; path: string }[] = [
  { tab: 'overview', label: 'Overview', path: '/workshop' },
  { tab: 'sources', label: 'Sources', path: '/workshop/sources' },
  { tab: 'storage', label: 'Storage', path: '/workshop/storage' },
  { tab: 'diagnostics', label: 'Diagnostics', path: '/workshop/diagnostics' },
];

export type FileCheck = { running: boolean; at: number | null };
export type PlaybackFacts = { refusal: string | null; speaker: string | null; phase: string };

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
    <main className="page browse workspace" id="main">
      <h1 className="display small">Workspace</h1>
      <LinkTabs label="Workspace" items={TABS} current={here} />
      {tab === 'overview' && <Overview status={status} workspaceId={workspaceId} savedMixes={savedMixes} fileCheck={fileCheck} stemsShown={stemsShown} measuringKeys={measuringKeys} />}
      {tab === 'sources' && <>{connect}<RememberedFolder workspaceId={workspaceId} /></>}
      {tab === 'storage' && (
        <>
          <StorageCard degraded={degraded} />
          {stems}
          {on('cloud.local_media') && <DeviceDataCard workspaceId={workspaceId} onCleared={() => window.location.reload()} />}
        </>
      )}
      {tab === 'diagnostics' && <BrowserDiagnostics openStore={openStore} playback={playback} />}
    </main>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Overview({ status, workspaceId, savedMixes, fileCheck, stemsShown, measuringKeys }: {
  status: AppStatus;
  workspaceId: string;
  savedMixes: number | null;
  fileCheck: FileCheck;
  stemsShown: boolean;
  measuringKeys: boolean;
}) {
  const { counts } = status;
  const importing = useImportSession(workspaceId);
  const checked = importing.registered + importing.failures.length;
  return (
    <>
      <div className="metrics">
        <div><strong>{counts.music ?? 0}</strong><span>songs in your library</span></div>
        <div><strong>{counts.ready ?? 0}</strong><span>can play in this browser</span></div>
        {(counts.missing ?? 0) > 0 && <div><strong>{counts.missing}</strong><span>not reported by any of your devices lately</span></div>}
        <div><strong>{savedMixes ?? '…'}</strong><span>{savedMixes === 1 ? 'saved mix' : 'saved mixes'}</span></div>
      </div>
      <section className="panel stack" aria-labelledby="cloud-background-title">
        <h2 id="cloud-background-title">In the background</h2>
        <p className="hint">What this browser is doing for SelectaDJ while this page is open. It stops when the page closes.</p>
        <ul className="stack">
          {importing.phase === 'running' && (
            <li><Status kind="working">{`Connecting music: ${checked} of ${importing.total ?? '…'} files checked so far.`}</Status></li>
          )}
          {(importing.phase === 'finished' || importing.phase === 'paused') && importing.summary && (
            <li><Status kind={importing.phase === 'paused' ? 'paused' : 'ready'}>{`Last import: ${summaryWords(importing.summary)}`}</Status></li>
          )}
          {importing.phase === 'failed' && <li><Status kind="failed">{importing.error || 'The last import stopped.'}</Status></li>}
          {importing.phase === 'idle' && <li><Status kind="ready">No music is being connected right now.</Status></li>}
          <li>
            {fileCheck.running
              ? <Status kind="working">Checking which connected songs this browser can still open.</Status>
              : fileCheck.at
                ? <Status kind="ready">{`Checked which connected songs this browser can open at ${clock(fileCheck.at)}. It checks again about twice a day while SelectaDJ is open.`}</Status>
                : <Status kind="queued">The check of which connected songs this browser can open has not finished yet.</Status>}
          </li>
          {measuringKeys && <li><Status kind="working">For Harmonic matches, this browser measures each song’s key from its file here, one song at a time, and more slowly while a mix plays.</Status></li>}
          {stemsShown && <li><Status kind="planned">Stem splitting for this browser is under Storage.</Status></li>}
        </ul>
      </section>
      <InterfaceChoices classicNav={false} />
      <section className="panel stack about-app" aria-labelledby="about-app-title">
        <h2 id="about-app-title">About</h2>
        <p className="hint">SelectaDJ is a REX Technologies product.</p>
      </section>
    </>
  );
}

/** The folder this browser remembers for carrying on an interrupted import. */
function RememberedFolder({ workspaceId }: { workspaceId: string }) {
  const [folder, setFolder] = useState<StoredFolderHandle | null | undefined>(undefined);
  const [access, setAccess] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void recallFolder(workspaceId).then(async (found) => {
      if (!live) return;
      setFolder(found ?? null);
      try {
        const state = found?.queryPermission ? await found.queryPermission({ mode: 'read' }) : null;
        if (live) setAccess(state);
      } catch { /* the browser would not say; nothing is claimed */ }
    }, () => { if (live) setFolder(null); });
    return () => { live = false; };
  }, [workspaceId]);
  if (folder === undefined) return null;
  return (
    <section className="panel stack" aria-labelledby="remembered-folder-title">
      <h2 id="remembered-folder-title">Remembered folder</h2>
      {folder ? (
        <>
          <p>
            {`This browser remembers ${folder.name}, the last folder you chose, so an import that stops part way can carry on.`}
            {access === 'granted' ? ' It may read it now.' : access ? ' It will ask your permission again before reading it.' : ''}
          </p>
          <p className="hint">To add new songs from it, choose the folder again above. Forgetting it removes nothing from your library.</p>
          <div className="row wrap">
            <Action run={async () => { await forgetFolder(workspaceId); setFolder(null); }}>Forget this folder</Action>
          </div>
        </>
      ) : (
        <p className="hint">No folder is remembered in this browser. When you choose a folder above, it is remembered here so an interrupted import can carry on.</p>
      )}
    </section>
  );
}

type Fact = { key: string; kind: StatusKind; words: string };
type Gathered = {
  facts: Fact[];
  summary: Record<string, unknown>;
};

const yes = (ok: boolean): StatusKind => (ok ? 'ready' : 'unavailable');

async function opfsWorks(): Promise<boolean | null> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage as (StorageManager & { getDirectory?: () => Promise<unknown> }) | undefined;
  if (!storage?.getDirectory) return null;
  try { await storage.getDirectory(); return true; } catch { return false; }
}

async function gather(openStore: () => Promise<MediaStore>, playback: PlaybackFacts, probe: ProbeResult | null): Promise<Gathered> {
  const hasAudio = typeof AudioContext !== 'undefined';
  // `in` on the prototype never calls the accessor, so it cannot throw "Illegal invocation"
  const hasWorklet = hasAudio && 'audioWorklet' in AudioContext.prototype;
  const folderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const isolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
  const online = typeof navigator === 'undefined' ? null : navigator.onLine;
  const [space, persist, opfs, index] = await Promise.all([
    storageSpace().catch((): StorageSpace => ({ supported: false, reason: 'The browser would not say.' })),
    readPersistState().catch((): PersistState => 'unsupported'),
    opfsWorks(),
    openStore().then((opened) => ({ opened: true, degraded: opened.degraded })).catch(() => ({ opened: false, degraded: true })),
  ]);
  const off = FLAG_IDS.filter((id) => !flagOn(id));
  const facts: Fact[] = [
    { key: 'audio', kind: yes(hasAudio && hasWorklet), words: hasAudio && hasWorklet ? 'This browser has Web Audio with AudioWorklet, which SelectaDJ mixes with.' : hasAudio ? 'This browser has Web Audio but no AudioWorklet, so it cannot mix here.' : 'This browser has no Web Audio, so it cannot play mixes here.' },
    probe
      ? (probe.ok
        ? { key: 'probe', kind: 'ready', words: `The audio check ran at ${probe.sampleRate} Hz with ${probe.schedulingMisses} scheduling ${probe.schedulingMisses === 1 ? 'gap' : 'gaps'} in ${probe.blocks} blocks. This shows audio runs here, not that your speakers are on.` }
        : { key: 'probe', kind: 'failed', words: `The audio check did not pass: ${probe.reason}` })
      : { key: 'probe', kind: 'planned', words: 'The audio check has not run yet in this visit.' },
    playback.refusal
      ? { key: 'playback', kind: 'blocked', words: `Playing here was refused: ${playback.refusal}` }
      : { key: 'playback', kind: 'ready', words: playback.speaker === 'elsewhere' ? 'Another device is the speaker; this browser is controlling it.' : playback.speaker === 'here' ? `This browser is the speaker (${playback.phase}).` : 'No device is playing right now.' },
    { key: 'index', kind: index.opened && !index.degraded ? 'ready' : 'warning', words: index.opened && !index.degraded ? 'The list of connected songs is kept in this browser (IndexedDB).' : 'This browser is not keeping the list of connected songs, so they need connecting again next visit.' },
    { key: 'opfs', kind: opfs === null ? 'unavailable' : yes(opfs), words: opfs === null ? 'This browser has no private file storage (OPFS).' : opfs ? 'Private file storage (OPFS) opens.' : 'Private file storage (OPFS) did not open.' },
    { key: 'persist', kind: persist === 'granted' ? 'ready' : 'warning', words: persist === 'granted' ? 'The browser has agreed to keep SelectaDJ’s details on this device.' : 'The browser may clear SelectaDJ’s details if the device runs short of space.' },
    { key: 'space', kind: space.supported ? 'ready' : 'unavailable', words: space.supported ? `Browser storage in use: ${((space.usage ?? 0) / 1_000_000).toFixed(1)} MB of ${((space.quota ?? 0) / 1_000_000).toFixed(0)} MB allowed.` : space.reason ?? 'The browser does not say how much storage SelectaDJ may use.' },
    { key: 'folders', kind: yes(folderPicker), words: folderPicker ? 'Folders can be chosen and remembered here.' : 'Folders cannot be remembered here; songs are chosen each visit.' },
    { key: 'online', kind: online === false ? 'warning' : 'ready', words: online === false ? 'This browser says it is offline.' : 'This browser says it is online.' },
    { key: 'flags', kind: 'ready', words: `${countOf(FLAG_IDS.length - off.length, 'feature')} on and ${off.length} off for this account in this browser.` },
  ];
  const summary = {
    engine: ENGINE_VERSION,
    web_audio: hasAudio,
    audio_worklet: hasWorklet,
    audio_check: probe ? (probe.ok ? { ok: true, sample_rate: probe.sampleRate, scheduling_misses: probe.schedulingMisses, blocks: probe.blocks } : { ok: false, reason: probe.reason }) : 'not run',
    playback: { refused: playback.refusal, speaker: playback.speaker, phase: playback.phase },
    indexeddb: index,
    opfs,
    persistence: persist,
    storage: space.supported ? { usage_mb: Math.round((space.usage ?? 0) / 100_000) / 10, quota_mb: Math.round((space.quota ?? 0) / 1_000_000) } : 'not reported',
    folder_picker: folderPicker,
    cross_origin_isolated: isolated,
    online,
    flags_off: off,
  };
  return { facts, summary };
}

/** What this browser can do for SelectaDJ, measured here. The copied summary holds no names,
 * emails, folder or song names, account or device ids: only capabilities and states. */
function BrowserDiagnostics({ openStore, playback }: { openStore: () => Promise<MediaStore>; playback: PlaybackFacts }) {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [gathered, setGathered] = useState<Gathered | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    setGathered(await gather(openStore, playback, probe));
    setCopied(false);
  }, [openStore, playback.refusal, playback.speaker, playback.phase, probe]);
  useEffect(() => { void load(); }, [load]);
  const runCheck = async () => {
    if (typeof AudioContext === 'undefined') {
      setProbe({ ok: false, state: 'unsupported_here', reason: 'This browser has no Web Audio.' });
      return;
    }
    // made inside the press, so the browser lets it start; closed again straight after
    const context = new AudioContext();
    try {
      await context.resume().catch(() => undefined);
      setProbe(await probeCapability(context));
    } catch (problem) {
      setProbe({ ok: false, state: 'unsupported_here', reason: (problem as Error)?.message || 'unknown reason' });
    } finally {
      void context.close().catch(() => undefined);
    }
  };
  if (!gathered) return <section className="panel stack"><h2>Diagnostics</h2><Skeleton variant="rows" lines={6} label="Checking this browser" /></section>;
  const text = JSON.stringify(gathered.summary, null, 2);
  const canCopy = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  return (
    <section className="panel stack" aria-labelledby="browser-diagnostics-title">
      <h2 id="browser-diagnostics-title">Diagnostics</h2>
      <p className="hint">What this browser can do for SelectaDJ, checked here. Nothing is sent anywhere unless you copy it and share it yourself.</p>
      <ul className="diagnostic-facts">
        {gathered.facts.map((fact) => <li key={fact.key}><Status kind={fact.kind}>{fact.words}</Status></li>)}
      </ul>
      <details className="diagnostic-raw">
        <summary>The raw details</summary>
        <pre className="diagnostics" tabIndex={0}>{text}</pre>
      </details>
      <p className="hint">The copy holds what this browser can do and which features are off. It has no names, emails, songs, folders or account details.</p>
      <div className="row wrap">
        <Action run={runCheck}>{probe ? 'Run the audio check again' : 'Run the audio check'}</Action>
        {canCopy && (
          <Action run={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}>
            {copied ? 'Copied' : 'Copy'}
          </Action>
        )}
        <Action run={load}>Check again</Action>
      </div>
    </section>
  );
}
