import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ENGINE_INSTALL_GUIDE, LOCAL_ENGINE_URL } from './contract';
import './folderWatches.css';

/** These routes exist only in the loopback Cloud development companion.
 * Production Cloud never accepts a source path, audio file or filesystem command. */
export type WatchedFolder = {
  id: string; name: string; path: string; enabled: boolean; available: boolean;
  state: string; indexed: number; discovered: number;
  lastScannedAt: number | null; lastAttemptAt: number | null; problem: string | null;
};
export type WatchSnapshot = { device: string; everySeconds: number; sources: WatchedFolder[] };

const LOOPBACK = new Set(['localhost', '127.0.0.1']);
const STATUS: Record<string, string> = {
  ready: 'Watching', scanning: 'Scanning', stale: 'Checking for changes',
  offline: 'Drive disconnected', degraded: 'Needs attention', cancelled: 'Scan stopped',
  paused: 'Paused', unknown: 'Not checked yet',
};

function cleanCount(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}
function timestamp(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
function object(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
export function parseWatchedFolders(data: unknown): WatchSnapshot {
  const raw = object(data);
  if (raw.schema_version !== 1 || !Array.isArray(raw.sources)) {
    throw new Error('The local folder manager returned an unsupported response.');
  }
  const known = new Set<string>();
  const sources = raw.sources.slice(0, 250).map((entry): WatchedFolder | null => {
    const s = object(entry);
    if (typeof s.id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(s.id) || known.has(s.id)) return null;
    known.add(s.id);
    return {
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 120) : 'Music folder',
      path: typeof s.path === 'string' ? s.path.slice(0, 2048) : '',
      enabled: s.enabled === true,
      available: s.available === true,
      state: typeof s.state === 'string' && s.state in STATUS ? s.state : 'unknown',
      indexed: cleanCount(s.indexed), discovered: cleanCount(s.discovered),
      lastScannedAt: timestamp(s.last_scanned_at),
      lastAttemptAt: timestamp(s.last_attempt_at),
      problem: typeof s.problem === 'string' ? s.problem.slice(0, 200) : null,
    };
  }).filter((item): item is WatchedFolder => item !== null);
  return {
    device: typeof raw.device === 'string' ? raw.device.slice(0, 80) : 'This computer',
    everySeconds: cleanCount(raw.watch_every_seconds), sources,
  };
}

async function localRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'X-Selecta-Local-Watch': '1',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'same-origin',
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = object(payload).detail;
    throw new Error(typeof reason === 'string' ? reason : 'The local source manager did not accept this request.');
  }
  if (payload === null) throw new Error('The local source manager is not available.');
  return payload as T;
}
const ROOT = '/dev/local-watches';

function lastChecked(epoch: number | null): string {
  if (epoch === null) return 'Not scanned yet';
  return 'Last completed ' + new Date(epoch * 1000).toLocaleString('en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}
function sourceStatus(source: WatchedFolder): { label: string; kind: 'ready' | 'busy' | 'warn' | 'quiet' } {
  if (!source.enabled) return { label: 'Paused', kind: 'quiet' };
  if (!source.available || source.state === 'offline') return { label: 'Drive disconnected', kind: 'warn' };
  if (source.problem || source.state === 'degraded') return { label: 'Needs attention', kind: 'warn' };
  if (source.state === 'scanning') return { label: 'Scanning locally', kind: 'busy' };
  if (source.state === 'ready') return { label: 'Watching', kind: 'ready' };
  return { label: STATUS[source.state] ?? 'Waiting for first check', kind: 'quiet' };
}

export function FolderWatches({ compact = false }: { compact?: boolean }) {
  // A remote Cloud deployment is never allowed to request a path from its users.
  // This development-only manager is confined to the same machine as dev.cmd cloud.
  const local = typeof window !== 'undefined' && LOOPBACK.has(window.location.hostname);
  const [snapshot, setSnapshot] = useState<WatchSnapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable' | 'error'>(local ? 'loading' : 'unavailable');
  const [addOpen, setAddOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [search, setSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [showPaused, setShowPaused] = useState(true);
  const [pending, setPending] = useState('');
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async (showLoading = false) => {
    if (!local) return;
    const current = ++sequence.current;
    if (showLoading) setPhase('loading');
    try {
      const next = parseWatchedFolders(await localRequest<unknown>(ROOT));
      if (current !== sequence.current) return;
      setSnapshot(next);
      setPhase('ready');
      setUpdatedAt(Date.now());
    } catch (error) {
      if (current !== sequence.current) return;
      if (!navigator.onLine) {
        setPhase('error');
      } else {
        setPhase((previous) => previous === 'ready' ? 'error' : 'unavailable');
      }
    }
  }, [local]);

  useEffect(() => {
    if (!local) return;
    void refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const online = () => void refresh();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      ++sequence.current;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
    };
  }, [local, refresh]);

  const change = async (key: string, action: () => Promise<unknown>, message: string) => {
    setPending(key); setProblem(''); setNotice('');
    try {
      await action();
      setNotice(message);
      await refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The local device could not apply that change.');
    } finally { setPending(''); }
  };

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = folder.trim();
    if (!path || pending) return;
    setPending('add'); setProblem(''); setNotice('');
    try {
      const check = await localRequest<{ ok: boolean; reason?: string }>(ROOT + '/check?folder=' + encodeURIComponent(path));
      if (!check.ok) {
        setProblem(check.reason ?? 'This folder cannot be watched.');
        return;
      }
      await localRequest(ROOT, { method: 'POST', body: JSON.stringify({ folder: path }) });
      setFolder(''); setAddOpen(false);
      setNotice('Folder added. Indexing is queued on this computer; it does not upload music.');
      await refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not add that folder.');
    } finally { setPending(''); }
  };

  const active = snapshot?.sources.filter((s) => s.enabled).length ?? 0;
  const indexed = snapshot?.sources.filter((s) => s.enabled).reduce((total, s) => total + s.indexed, 0) ?? 0;
  const issues = snapshot?.sources.filter((s) => s.enabled && sourceStatus(s).kind === 'warn').length ?? 0;
  const visible = (snapshot?.sources ?? []).filter((s) =>
    (showPaused || s.enabled) &&
    (!attentionOnly || sourceStatus(s).kind === 'warn') &&
    (!search || (s.name + ' ' + s.path).toLowerCase().includes(search.toLowerCase().trim()))
  );
  return <section className={'lfw-root' + (compact ? ' lfw-compact' : '')} aria-labelledby="lfw-title">
    <div className="lfw-heading">
      <div>
        <p className="cloud-eyebrow">LOCAL MUSIC · YOUR DEVICE</p>
        <h2 id="lfw-title">Watch your music folders</h2>
        <p>Choose as many folders or drives as you need. New recordings are discovered automatically, without uploading your audio to Cloud.</p>
      </div>
      {phase === 'ready' && <button className="primary" type="button" onClick={() => { setAddOpen((v) => !v); setProblem(''); }} aria-expanded={addOpen} aria-controls="lfw-add">
        {addOpen ? 'Close' : '+ Add folder'}
      </button>}
    </div>

    {phase === 'unavailable' && <div className="lfw-empty" role="status">
      <strong>Folder management runs on the music device.</strong>
      <p>{local ? 'The local folder companion is not responding. Start the latest Cloud development stack and try again.' : 'This browser cannot inspect a remote computer. Open Selecta on the device holding your music to add, pause, or re-link folders.'}</p>
      <div className="lfw-actions">
        {local && <button type="button" onClick={() => void refresh(true)}>Try again</button>}
        {!local && <a href={LOCAL_ENGINE_URL} target="_blank" rel="noopener noreferrer">Open the local engine on this device</a>}
        <a href={ENGINE_INSTALL_GUIDE} target="_blank" rel="noopener noreferrer">Local engine setup</a>
      </div>
    </div>}

    {phase === 'loading' && <p className="lfw-load" role="status">Checking folder watches on this computer…</p>}
    {phase === 'error' && <div className="lfw-warning" role="alert">The latest local folder status could not be read. Previous counts may be stale. <button onClick={() => void refresh(true)}>Retry</button></div>}
    {notice && <p className="lfw-notice" role="status">{notice}</p>}
    {problem && <p className="lfw-warning" role="alert">{problem}</p>}

    {snapshot && <>
      <div className="lfw-metrics" aria-label="Watched folder summary">
        <div><strong>{active}</strong><span>Watching</span></div>
        <div><strong>{indexed.toLocaleString()}</strong><span>Locally indexed</span></div>
        <div><strong>{issues}</strong><span>Need attention</span></div>
      </div>
      <div className="lfw-toolbar">
        <div><strong>{snapshot.device}</strong><span> · Checks roughly every {Math.max(1, Math.round(snapshot.everySeconds / 60))} minutes</span></div>
        <button type="button" disabled={phase === 'loading'} onClick={() => void refresh(true)}>Refresh status</button>
      </div>

      <div id="lfw-add" hidden={!addOpen} className="lfw-add">
        <form onSubmit={(event) => void add(event)}>
          <label htmlFor="lfw-path">Folder address on this computer</label>
          <div className="lfw-add-row">
            <input id="lfw-path" autoComplete="off" spellCheck={false} value={folder}
              onChange={(e) => { setFolder(e.target.value); setProblem(''); }}
              placeholder="C:\\Users\\you\\Music" required maxLength={2048} />
            <button type="submit" className="primary" disabled={pending !== '' || !folder.trim()}>
              {pending === 'add' ? 'Checking…' : 'Watch folder'}
            </button>
          </div>
          <p>Include subfolders automatically. Use an absolute folder address from this device, not a web URL or a remote speaker path.</p>
        </form>
      </div>

      {(snapshot.sources.length > 3) && <div className="lfw-filters">
        <label>Find a folder <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search watched folders" /></label>
        <label><input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} /> Needs attention only</label>
        <label><input type="checkbox" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} /> Show paused</label>
      </div>}
      {snapshot.sources.length === 0 && <div className="lfw-empty">
        <div className="lfw-folder-symbol" aria-hidden="true">♫</div>
        <h3>No folders watched yet</h3>
        <p>Connect your Music folder, a DJ library, or an external drive. Your original files will stay where they are.</p>
        <button type="button" className="primary" onClick={() => setAddOpen(true)}>Add your first folder</button>
      </div>}
      {snapshot.sources.length > 0 && visible.length === 0 && <p className="lfw-empty">No folders match your filters. Clear the search to see all watched sources.</p>}
      {visible.length > 0 && <ul className="lfw-list" aria-label="Local folder watches">{visible.map((source) => {
        const state = sourceStatus(source);
        const key = source.id;
        return <li className="lfw-item" key={key}>
          <div className="lfw-row">
            <div className="lfw-folder-symbol" aria-hidden="true">♫</div>
            <div className="lfw-folder-main">
              <div className="lfw-name"><h3>{source.name}</h3><span className={'lfw-pill lfw-' + state.kind}>{state.label}</span></div>
              <p className="lfw-path" title={source.path}>{source.path}</p>
              <p className="lfw-detail">{source.indexed.toLocaleString()} indexed recordings · {lastChecked(source.lastScannedAt)}</p>
              {!source.available && source.enabled && <p className="lfw-hint">Reconnect the drive or restore folder permissions. Previously indexed recordings are kept; availability is not verified.</p>}
              {source.problem && <p className="lfw-hint">{source.problem} Try a rescan after checking this device.</p>}
              {source.state === 'scanning' && <p className="lfw-hint" role="status">Reading this folder locally. Files are not copied to Cloud.</p>}
            </div>
            <div className="lfw-item-actions">
              <button type="button" disabled={!source.enabled || pending !== '' || !source.available || source.state === 'scanning'}
                onClick={() => void change(key, () => localRequest(ROOT + '/' + encodeURIComponent(key) + '/scan', { method: 'POST' }), 'A local scan was requested. Counts update after the engine reports progress.')}>Scan now</button>
              <button type="button" disabled={pending !== ''}
                onClick={() => void change(key, () => localRequest(ROOT + '/' + encodeURIComponent(key), { method: 'PATCH', body: JSON.stringify({ enabled: !source.enabled }) }),
                  source.enabled ? 'Watching paused. Files and indexed recordings have been kept.' : 'Watching resumed. A scan has been queued on this device.')}>
                {source.enabled ? 'Pause' : 'Resume'}
              </button>
              <button type="button" disabled={pending !== ''} aria-expanded={confirmStop === key}
                onClick={() => setConfirmStop(confirmStop === key ? null : key)}>Stop watching</button>
            </div>
          </div>
          {confirmStop === key && <div className="lfw-confirm" role="group" aria-label={'Stop watching ' + source.name}>
            <strong>Remove this watch?</strong>
            <p>This removes only the folder from the watch list. Audio files and previously indexed recordings are not deleted. You can re-add it at any time.</p>
            <div className="lfw-actions">
              <button type="button" onClick={() => setConfirmStop(null)}>Keep folder</button>
              <button type="button" className="lfw-danger" disabled={pending !== ''} onClick={() => void change(key,
                () => localRequest(ROOT + '/' + encodeURIComponent(key), { method: 'DELETE' }).then(() => setConfirmStop(null)),
                'Folder removed from the watch list. No recordings were deleted.')}>Stop watching this folder</button>
            </div>
          </div>}
        </li>;
      })}</ul>}
      {updatedAt && <p className="lfw-footnote">Status updated {new Date(updatedAt).toLocaleTimeString('en-GB', { timeStyle: 'short' })}. Indexing happens on this computer; these counts do not describe hosted assets.</p>}
    </>}
    <p className="lfw-privacy">Your audio never leaves this device through folder watching. When using Selecta Cloud on another computer, you must manage its folders on that computer.</p>
  </section>;
}

/** Legacy hosted accounts keep their existing upload flow, with an explicit local alternative. */
export function LegacyFolderWatchEntry() {
  const [open, setOpen] = useState(false);
  return <div className="lfw-entry">
    <div>
      <p className="cloud-eyebrow">ALSO AVAILABLE · DEVICE-LOCAL MUSIC</p>
      <h2>Prefer to watch a music folder?</h2>
      <p>Connect several folders or drives, and Selecta checks them for new recordings automatically. This is separate from your existing Cloud uploads: originals stay on this computer.</p>
    </div>
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Hide folder watches' : 'Manage folder watches'}
    </button>
    {open && <div className="lfw-entry-expanded"><FolderWatches compact /></div>}
  </div>;
}
