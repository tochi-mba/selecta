import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Request } from '../api';
import { flagOn, useFlag } from '../flags';
import { dirPicker, directoryInput, findLapsed, forgetFolder, recallFolder, refreshDeviceAvailability, rememberFolder, runImport } from '../media';
import type { DirectoryHandleLike, ImportEvent, ImportSource, ImportSummary, LapsedItem, MediaStore, RegrantOutcome, StoredFolderHandle } from '../media';
import { importSummaryWords, useImportAnnouncer } from './importAnnouncer';
import { countOf } from '../ui/format';
import { cancelImportSession, clearImportMarker, readImportMarker, startImportSession, useImportSession, type ImportRunner } from './importSession';

/** Connect Music in the local-first Library (ADR-0458 import, ADR-0463 surfaces).
 *
 * Nothing is uploaded: the importer reads each file on this device, records its fingerprint and
 * tags in the catalogue, and keeps a handle so the file can be played later. The member sees
 * progress per file, can cancel at any point, sees exactly which files failed and why, and gets
 * a list of songs whose permission lapsed with a way to allow them again.
 */

export type FileRow = { name: string; stage: 'hashing' | 'registering' | 'done' | 'failed'; reason?: string; duplicate?: boolean };

/** Fold one importer event into the rows and summary the surface shows. Pure, for tests. */
export function applyImportEvent(rows: FileRow[], event: ImportEvent): FileRow[] {
  if (event.kind !== 'file') return rows;
  const row: FileRow = event.stage === 'failed'
    ? { name: event.name, stage: 'failed', reason: event.reason }
    : event.stage === 'done'
      ? { name: event.name, stage: 'done', duplicate: event.duplicateOf !== undefined }
      : { name: event.name, stage: event.stage };
  const at = rows.findIndex((existing) => existing.name === event.name && existing.stage !== 'done' && existing.stage !== 'failed');
  if (at < 0) return [...rows, row];
  const next = rows.slice();
  next[at] = row;
  return next;
}

/** What an import did, in words (the announcer says the same at the finish). */
export function summaryWords(summary: ImportSummary): string {
  return importSummaryWords(summary);
}

const REGRANT_WORDS: Record<RegrantOutcome['status'], string> = {
  recovered: 'Allowed again. It plays from this device.',
  denied: 'Still not allowed. The browser asks again next time you press Allow.',
  different_file: 'That file has changed since you connected it, so it was not reconnected. Connect it again as a new song.',
  missing: 'The file is no longer where it was. Connect it again from its new place.',
};

/** This browser profile's stable id for the availability report: the same keys the onboarding
 * spine uses (cloud/onboarding/deps.ts), so both report one device, never a path or a name. */
export function mediaDeviceId(workspaceId: string): string {
  const shared = `selecta.device.${workspaceId}`;
  const own = `selecta.media-profile.${workspaceId}`;
  try {
    const known = localStorage.getItem(shared) ?? localStorage.getItem(own);
    if (known) return known;
  } catch { /* fall through to a fresh id */ }
  const made = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(own, made); } catch { /* this visit only */ }
  return made;
}

/** This browser's playback device id once it is registered with the server, else null.
 * Availability reports need it: the server accepts them only for the member's own registered
 * device, so reporting under the unregistered profile id is always refused (`unknown_device`). */
export function registeredDeviceId(workspaceId: string): string | null {
  try { return localStorage.getItem(`selecta.device.${workspaceId}`); } catch { return null; }
}

export function ConnectMusic({ request, workspaceId, openStore, importer = runImport, onAvailabilityChanged }: {
  /** Asks with full /api paths, as the media importer does. */
  request: Request;
  workspaceId: string;
  openStore: () => Promise<MediaStore>;
  importer?: typeof runImport;
  /** Reconcile this device's catalogue availability after a permission is restored. */
  onAvailabilityChanged?: () => void | Promise<void>;
}) {
  const live = useImportSession(workspaceId);
  useImportAnnouncer();
  const progressive = useFlag('cloud.progressive_import');
  const [problem, setProblem] = useState('');
  const [lapsed, setLapsed] = useState<LapsedItem[]>([]);
  const [regranted, setRegranted] = useState<Record<number, string>>({});
  const [degraded, setDegraded] = useState(false);
  const picker = dirPicker();
  const folderInput = directoryInput();
  // the resume offer: an import that stopped part way last visit, and the folder it read if the
  // browser kept a handle to it
  const [marker, setMarker] = useState(() => (progressive ? readImportMarker(workspaceId) : null));
  // undefined until the folder store has answered, so the offer never flickers between its forms
  const [recalled, setRecalled] = useState<StoredFolderHandle | null | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  // real buttons drive the file inputs, so the pickers are reachable from the keyboard
  const folderPick = useRef<HTMLInputElement>(null);
  const songsPick = useRef<HTMLInputElement>(null);

  const checkLapsed = useCallback(async () => {
    try {
      const store = await openStore();
      setDegraded(store.degraded);
      setLapsed(await findLapsed(store));
    } catch { setLapsed([]); }
  }, [openStore]);
  useEffect(() => { void checkLapsed(); }, [checkLapsed]);
  // With `cloud.progressive_import` off, leaving this panel stops the import as it always did;
  // on, the import belongs to the session and keeps going.
  useEffect(() => () => { if (!flagOn('cloud.progressive_import')) cancelImportSession(); }, []);
  useEffect(() => {
    if (!marker) return undefined;
    let current = true;
    void recallFolder(workspaceId).then((found) => { if (current) setRecalled(found ?? null); }, () => { if (current) setRecalled(null); });
    return () => { current = false; };
  }, [marker, workspaceId]);
  useEffect(() => {
    if (live.phase === 'finished' || live.phase === 'paused') {
      void openStore().then((store) => setDegraded(store.degraded)).catch(() => undefined);
    }
  }, [live.phase, openStore]);

  const start = (source: ImportSource, folder?: string) => {
    setProblem(''); setRefused(false); setMarker(null);
    const run: ImportRunner = async (given, onProgress, signal) => importer({
      source: given, request, store: await openStore(), deviceId: mediaDeviceId(workspaceId), onProgress, signal,
    });
    void startImportSession({ source, run, workspaceId, folder });
  };

  const chooseFolder = async () => {
    try {
      const handle = await (window as unknown as { showDirectoryPicker(options?: { mode: 'read' }): Promise<DirectoryHandleLike> }).showDirectoryPicker({ mode: 'read' });
      void rememberFolder(workspaceId, handle);
      start(handle, handle.name);
    } catch (error) {
      // closing the picker is a choice, not a failure
      if ((error as Error).name !== 'AbortError') setProblem((error as Error).message);
    }
  };
  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files?.length) start(Array.from(files));
    event.target.value = '';
  };
  const keepChecking = async (handle: StoredFolderHandle) => {
    const answer = handle.requestPermission ? await handle.requestPermission({ mode: 'read' }).catch(() => 'denied') : 'granted';
    if (answer === 'granted') start(handle, handle.name);
    else setRefused(true);
  };
  const forget = () => {
    void forgetFolder(workspaceId);
    clearImportMarker(workspaceId);
    setMarker(null); setRecalled(null); setRefused(false);
  };

  const allow = async (item: LapsedItem) => {
    const outcome = await item.regrant();
    setRegranted((current) => ({ ...current, [item.songId]: REGRANT_WORDS[outcome.status] }));
    if (outcome.status === 'recovered') {
      // A successful re-grant makes this copy requestable in Rooms again. A report failure
      // must not undo the local recovery or replace its truthful confirmation.
      try {
        if (onAvailabilityChanged) await onAvailabilityChanged();
        else { const device = registeredDeviceId(workspaceId); if (device) await refreshDeviceAvailability(request, await openStore(), device); }
      } catch { /* startup and the next periodic refresh can retry the catalogue report */ }
    }
  };

  const running = live.phase === 'running';
  const checked = live.registered + live.failures.length;
  const failures = live.failures;
  const shownProblem = problem || (live.phase === 'failed' ? live.error || 'The import stopped. Nothing after the last connected song was changed.' : '');
  const offer = progressive && live.phase === 'idle' && marker && recalled !== undefined;
  const folderName = marker?.folder ?? recalled?.name;
  return (
    <section className="panel stack connect-music" aria-labelledby="connect-music-title">
      <h2 id="connect-music-title">Connect music</h2>
      <p className="hint">Your music stays on this device. SelectaDJ keeps only each song’s title, artist and a fingerprint, so your library and mixes work on your other devices.</p>
      {offer && recalled && !refused && (
        <div className="stack" role="note">
          <p>{`An import of ${folderName} was interrupted. Anything already checked is in your library.`}</p>
          <div className="row wrap">
            <button className="primary" onClick={() => void keepChecking(recalled)}>{`Keep checking ${folderName}`}</button>
            <button className="quiet" onClick={forget}>Forget this</button>
          </div>
        </div>
      )}
      {offer && refused && <p role="alert">The browser did not allow it. Choose the folder again.</p>}
      {offer && !recalled && !refused && (
        <p role="note">An import stopped part way last time. Anything already checked is in your library. Choose the same folder or files again and SelectaDJ will recognise them; nothing is duplicated.</p>
      )}
      {!running && (
        <div className="row wrap">
          {picker.supported && <button className="primary" onClick={() => void chooseFolder()}>Choose a folder</button>}
          {!picker.supported && folderInput.supported && (
            <>
              <button type="button" className="primary" onClick={() => folderPick.current?.click()}>Choose a folder</button>
              <input ref={folderPick} type="file" hidden tabIndex={-1} aria-hidden="true" multiple {...{ webkitdirectory: '' }} onChange={chosen} />
            </>
          )}
          <button type="button" onClick={() => songsPick.current?.click()}>Choose songs</button>
          <input ref={songsPick} type="file" hidden tabIndex={-1} aria-hidden="true" multiple accept="audio/*" onChange={chosen} />
        </div>
      )}
      {!picker.supported && <p className="hint">{picker.reason}</p>}
      {degraded && <p className="hint" role="note">This browser is not keeping SelectaDJ’s list of connected files, so you will need to connect them again next visit.</p>}
      {running && (
        <div className="stack">
          <p><b>Connecting your music…</b> {checked} of {live.total ?? '…'} files checked so far.</p>
          {typeof live.total === 'number'
            ? <progress max={Math.max(live.total, 1)} value={checked} aria-label="Files checked" />
            : <progress aria-label="Files checked" />}
          <button onClick={cancelImportSession}>Cancel</button>
        </div>
      )}
      {(live.phase === 'finished' || live.phase === 'paused') && live.summary && <p>{summaryWords(live.summary)}</p>}
      {shownProblem && <p className="error" role="alert">{shownProblem}</p>}
      {failures.length > 0 && (
        <details open={failures.length <= 5}>
          <summary>{countOf(failures.length, 'file')} could not be connected</summary>
          <ul>
            {failures.map((failure, index) => <li key={`${failure.name}-${index}`}><b dir="auto">{failure.name}</b>: {failure.reason}</li>)}
          </ul>
        </details>
      )}
      {lapsed.length > 0 && (
        <div className="stack" aria-labelledby="connect-music-lapsed">
          <h3 id="connect-music-lapsed">Songs this browser needs permission for again</h3>
          <p className="hint">Browsers forget file permissions between visits. Allow each one to play it from this device again.</p>
          <ul>
            {lapsed.map((item) => (
              <li key={item.songId} className="row wrap">
                <span dir="auto">{item.title}</span>
                <span className="hint">{item.why === 'permission' ? 'Needs permission' : item.why === 'changed' ? 'File contents changed' : 'File not found'}</span>
                {regranted[item.songId]
                  ? <span role="status">{regranted[item.songId]}</span>
                  : <button onClick={() => void allow(item)}>{item.why === 'permission' ? 'Allow' : item.why === 'changed' ? 'Check file' : 'Look again'}</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
