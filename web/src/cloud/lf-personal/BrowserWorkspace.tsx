import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Page } from '../api';
import { assessBrowserDevice, type BrowserCapabilityProfile } from '../../device-capabilities/profile';
import { directoryFiles, localCatalogue, type LocalDirectoryHandle } from '../../media/localCatalogue';
import { READINESS_LABELS, type LocalRecording, type MediaScanProgress } from '../../media/types';
import { browserEngine, retainBrowserEngine } from '../../engine/registry';
import './browserWorkspace.css';

type Props = { workspaceId: string; go: (page: Page) => void };
const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.aiff,.aif,.flac,.ogg,.opus,.webm';
const GUIDANCE = 'Music is read in this browser. Originals, folders and private hashes are never sent to Selecta Cloud.';
function useLocalMedia(workspaceId: string) {
  const catalogue = useMemo(() => localCatalogue(workspaceId), [workspaceId]);
  const [revision, setRevision] = useState(0);
  useEffect(() => catalogue.subscribe(() => setRevision((n) => n + 1)), [catalogue]);
  return { catalogue, sources: useMemo(() => catalogue.sources, [catalogue, revision]),
    recordings: useMemo(() => catalogue.recordings, [catalogue, revision]) };
}
function useProfile() {
  const [profile, setProfile] = useState<BrowserCapabilityProfile | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const check = useCallback(async () => {
    setChecking(true); setError('');
    try { setProfile(await assessBrowserDevice()); }
    catch { setError('The capability check was interrupted. Try again when this tab is active.'); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  return { profile, checking, error, check };
}
function formatDuration(seconds: number | null) {
  if (seconds == null) return 'Duration unverified';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}
function CapabilityList({ profile }: { profile: BrowserCapabilityProfile | null }) {
  if (!profile) return <p role="status">Checking this browser’s available features…</p>;
  const important = [
    ['audio_decode', 'Audio decoding'], ['realtime_audio', 'Real-time audio'],
    ['render', 'On-device rendering'], ['workers', 'Background worker'],
    ['storage', 'Local storage'], ['output_selection', 'Output selection'],
    ['wake_lock', 'Keep screen awake'], ['webgpu_model', 'Neural models'],
  ] as const;
  return <ul className="br64-capabilities" aria-label="Device capability results">
    {important.map(([key, name]) => {
      const result = profile.features[key];
      return <li key={key}><strong>{name}</strong><span data-decision={result.decision}>{result.decision.replaceAll('_', ' ')}</span><small>{result.reason}</small></li>;
    })}
  </ul>;
}
export function BrowserConnectMusic({ workspaceId, go }: Props) {
  const { catalogue, recordings } = useLocalMedia(workspaceId);
  const { profile, checking, error: profileError, check } = useProfile();
  const [progress, setProgress] = useState<MediaScanProgress | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'files' | 'folder'>('files');
  const engine = useMemo(() => browserEngine(workspaceId), [workspaceId]);
  const playback = useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  const soundConfirmed = playback.soundCheck === 'user_confirmed';
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const browserPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  useEffect(() => { if (folderInput.current && 'webkitdirectory' in folderInput.current) folderInput.current.setAttribute('webkitdirectory', ''); }, []);
  useEffect(() => () => controller.current?.abort(), []);
  const startScan = async (items: File[], origin: 'file_input' | 'folder_input' | 'drop' | 'document_provider', label = 'Chosen music') => {
    if (!items.length) return;
    if (busy) { setProblem('Finish or cancel the previous scan first.'); return; }
    setProblem(''); setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try { await catalogue.scan(items, { origin, label, signal: abort.signal, onProgress: setProgress }); }
    catch (e) { setProblem((e as Error).name === 'AbortError' ? 'Scan cancelled; previously indexed recordings remain local.' : 'Some files could not be checked. Reconnect the source and try again.'); }
    finally { if (controller.current === abort) controller.current = null; setBusy(false); }
  };
  const selected = (event: ChangeEvent<HTMLInputElement>, folder: boolean) => {
    const items = Array.from(event.target.files || []);
    event.target.value = '';
    const folderName = folder ? items[0]?.webkitRelativePath?.split('/')[0] || 'Chosen folder' : 'Selected files';
    void startScan(items, folder ? 'folder_input' : 'file_input', folderName);
  };
  const dropped = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    void startScan(files, 'drop', 'Dropped files');
  };
  const openDirectory = async () => {
    const w = window as Window & { showDirectoryPicker?: () => Promise<LocalDirectoryHandle> };
    if (!w.showDirectoryPicker || busy) return;
    setBusy(true); setProblem('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const handle = await w.showDirectoryPicker();
      const files = await directoryFiles(handle, abort.signal);
      await catalogue.scan(files, { origin: 'directory_picker', label: handle.name, signal: abort.signal, onProgress: setProgress });
    } catch (e) {
      setProblem((e as Error).name === 'AbortError' ? 'Folder selection cancelled.' : 'Folder access was declined, expired, or the source was disconnected. Select files again.');
    } finally { if (controller.current === abort) controller.current = null; setBusy(false); }
  };
  const ready = recordings.filter((r) => r.readiness === 'ready').length;
  const sourceStep = recordings.length > 0;
  return <section className="br64-local" aria-label="Connect device music">
    <header><p className="cloud-eyebrow">BROWSER-NATIVE CLOUD</p><h2>Connect music on this device</h2><p>{GUIDANCE} No download, Python engine or music upload is needed.</p></header>
    <ol className="br64-steps" aria-label="Five setup steps">
      <li data-complete={sourceStep}>Connect Music</li><li data-complete={Boolean(profile)}>Check Device</li>
      <li data-complete={ready > 0}>Verify Music</li><li data-complete={soundConfirmed}>Choose Output</li>
      <li>Tap Start</li>
    </ol>
    <div className="br64-panel" onDrop={dropped} onDragOver={(e) => e.preventDefault()}>
      <h3>1. Connect music</h3>
      <p>Use the Files or document provider picker. USB/SD cards appear only when your browser grants access. Drag files here on supported desktops.</p>
      <input ref={input} type="file" multiple accept={ACCEPT} onChange={(e) => selected(e, false)} aria-label="Choose local music files" />
      <input ref={folderInput} type="file" multiple accept={ACCEPT} onChange={(e) => selected(e, true)} aria-label="Choose a music folder" hidden />
      <div className="br64-actions">
        <button type="button" onClick={() => { setMode('files'); input.current?.click(); }} disabled={busy}>Choose files</button>
        <button type="button" onClick={() => { setMode('folder'); folderInput.current?.click(); }} disabled={busy || !folderInput.current || !('webkitdirectory' in folderInput.current)}>Choose folder</button>
        {browserPicker && <button type="button" disabled={busy} onClick={() => void openDirectory()}>Open browser directory picker</button>}
      </div>
      {mode === 'folder' && <p className="br64-muted">Folder access depends on browser support; use file selection on iOS and other browsers without folder APIs.</p>}
      {busy && <button type="button" onClick={() => controller.current?.abort()}>Cancel local scan</button>}
      {progress && <p role="status">{progress.scanned} of {progress.total} files checked{progress.cancelled ? ' (cancelled)' : ''}</p>}
      {problem && <p role="alert">{problem}</p>}
    </div>
    <div className="br64-panel"><h3>2. Check this device</h3>
      <p>Phones and tablets can play and render when qualified; device type alone does not decide eligibility.</p>
      <button type="button" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Run capability check'}</button>
      {profileError && <p role="alert">{profileError}</p>}
      <CapabilityList profile={profile} />
    </div>
    <div className="br64-panel"><h3>3. Verify music</h3>
      <p>{ready} ready locally · {recordings.length - ready} not verified. Matching titles are not proof of an identical recording or master.</p>
      <button type="button" onClick={() => go('library')}>Review local library</button>
    </div>
    <div className="br64-panel"><h3>4. Choose output</h3>
      <p>Connect headphones or speakers and choose the system’s audio route. On iOS/iPadOS, output selection may only be available in system controls.</p>
      <p role="status">{soundConfirmed
        ? 'Output checked in the actual browser player. Recheck after switching speakers or browsers.'
        : 'Output not yet verified. Load a local track, tap Start in the player, then confirm you can hear the intended speaker.'}</p>
      <button type="button" onClick={() => go('library')}>Open local library and player</button>
      <p className="br64-muted">A browser heartbeat or audio meter cannot independently prove that sound is audible. Checking a box without playing sound is not verification.</p>
    </div>
    <div className="br64-panel"><h3>5. Tap Start</h3><p>Load a verified local track into the shared player from Library, then tap Start in the player. Keep the tab visible for venue operation.</p>
      <button className="primary" type="button" disabled={ready === 0} onClick={() => go('library')}>Open player and start</button>
    </div>
  </section>;
}
export function BrowserDeviceLibrary({ workspaceId, go }: Props) {
  const { catalogue, sources, recordings } = useLocalMedia(workspaceId);
  const [problem, setProblem] = useState('');
  const engine = useMemo(() => browserEngine(workspaceId), [workspaceId]);
  useEffect(() => retainBrowserEngine(workspaceId, engine), [workspaceId, engine]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const load = async (record: LocalRecording) => {
    setProblem(''); setLoadingId(record.id);
    try {
      const file = await catalogue.openRecording(record.id);
      // Use the same browser-wide AudioWorklet player as the persistent
      // transport. A separate <audio> preview bypassed the single-speaker
      // lease and could play simultaneously with venue or Studio audio.
      await engine.setQueue([{ id: record.id, title: record.title, file }]);
      setLoaded(record.id);
      // File permission revalidation is asynchronous: the user must tap Start
      // in the player to retain iOS/Android transient audio activation.
    } catch {
      setProblem('The track could not be loaded. Check permission, output, format and source connection; reimport if the recording changed.');
      setLoaded(null);
    } finally {
      setLoadingId(null);
    }
  };
  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recordings) if (r.identity.exactSha256) counts.set(r.identity.exactSha256, (counts.get(r.identity.exactSha256) || 0) + 1);
    return counts;
  }, [recordings]);
  return <section className="br64-local" aria-label="Device-local music library">
    <header><p className="cloud-eyebrow">PRIVATE LOCAL LIBRARY</p><h2>Music on this browser</h2>
      <p>{GUIDANCE} Removing an entry only forgets its browser binding; the original is never deleted.</p>
      <div className="br64-actions"><button className="primary" type="button" onClick={() => go('uploads')}>Connect music</button>
        <button type="button" onClick={() => go('uploads')}>Reimport or reauthorise</button></div>
    </header>
    <div className="br64-panel"><h3>Sources</h3>
      {sources.length === 0 ? <p>No local music connected. This is not the same as an empty Cloud account.</p> :
        <ul>{sources.map((source) => <li key={source.id}>
          <strong>{source.label}</strong> · {source.count} indexed · {source.state.replaceAll('_', ' ')}
          <button type="button" onClick={() => catalogue.forgetSource(source.id)} aria-label={'Forget ' + source.label}>Forget index only</button>
        </li>)}</ul>}
    </div>
    <div className="br64-panel"><h3>Local recordings ({recordings.length})</h3>
      {problem && <p role="alert">{problem}</p>}
      {loaded && <p role="status">Track loaded in the shared browser player. Tap Start in the player controls to hear it.</p>}
      {recordings.length === 0 ? <p>Choose files to add recordings to this device’s browser session.</p> :
        <ul className="br64-recordings">{recordings.map((record) => <li key={record.id}>
          <div><strong>{record.title}</strong>{record.artist && <span> · {record.artist}</span>}
            <small>{record.version || 'Unspecified master'} · {formatDuration(record.durationSeconds)} · {record.mime}</small>
            <small data-state={record.readiness}>{READINESS_LABELS[record.readiness]} — {record.reason}</small>
            {(duplicates.get(record.identity.exactSha256 || '') || 0) > 1 && <small>Exact local duplicate (different source binding)</small>}
          </div>
          <button type="button" disabled={record.readiness !== 'ready' || loadingId !== null}
            onClick={() => void load(record)}>
            {loadingId === record.id ? 'Loading…' : loaded === record.id ? 'Reload in player' : 'Load into player'}
          </button>
        </li>)}</ul>}
      <p className="br64-muted">Some codecs need a decoder even if their extension is supported. Playback and advanced DSP are separate validations. Changing a file invalidates its old recording identity.</p>
    </div>
  </section>;
}
