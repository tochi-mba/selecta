import { ChangeEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Request } from '../api';
import { flagOn, useFlag } from '../flags';
import { dirPicker, directoryInput, findLapsed, forgetFolder, recallFolder, refreshDeviceAvailability, rememberFolder, runImport } from '../media';
import type { DirectoryHandleLike, ImportEvent, ImportSource, ImportSummary, LapsedItem, MediaStore, RegrantOutcome, StoredFolderHandle } from '../media';
import { importSummaryWords, useImportAnnouncer } from './importAnnouncer';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/Meter';
import { cancelImportSession, clearImportMarker, readImportMarker, startImportSession, useImportSession, type ImportRunner } from './importSession';
import { preloadImportCode } from '../media/importer';
import { deleteImportJournal } from '../media/importJournal';
import { carryOnNow, dropResumeOffer, startImport } from './importResume';
import { CancelImportButton, checkedOf, checkedWords, formatCount, ImportProgressLine, ResumeOfferNotice } from './ImportStatus';
import './libraryWorkspace.css';

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

/** What a page's own button can ask Connect music to do (the Library header's main action). */
export type ConnectMusicHandle = {
  /** Opens the folder picker where the browser has one, else the file picker. */
  chooseFolder: () => void;
  chooseSongs: () => void;
  /** Whether "folder" is something this browser can pick at all. */
  folders: boolean;
};

/** `variant`: `card` is the whole card with its own buttons (Workspace > Sources); `hero` is the
 * empty Library's first step; `status` shows only what is happening or needs the member (progress,
 * an interrupted import, results, files that failed, lapsed permissions), for a page whose header
 * holds the buttons. */
export type ConnectMusicVariant = 'card' | 'hero' | 'status';

export const ConnectMusic = forwardRef<ConnectMusicHandle, {
  /** Asks with full /api paths, as the media importer does. */
  request: Request;
  workspaceId: string;
  openStore: () => Promise<MediaStore>;
  importer?: typeof runImport;
  /** Reconcile this device's catalogue availability after a permission is restored. */
  onAvailabilityChanged?: () => void | Promise<void>;
  variant?: ConnectMusicVariant;
}>(function ConnectMusic({ request, workspaceId, openStore, importer = runImport, onAvailabilityChanged, variant = 'card' }, ref) {
  const live = useImportSession(workspaceId);
  useImportAnnouncer();
  const progressive = useFlag('cloud.progressive_import');
  const resilient = useFlag('cloud.resilient_import');
  const [problem, setProblem] = useState('');
  const [lapsed, setLapsed] = useState<LapsedItem[]>([]);
  const [regranted, setRegranted] = useState<Record<number, string>>({});
  const [degraded, setDegraded] = useState(false);
  const picker = dirPicker();
  const folderInput = directoryInput();
  // the resume offer: an import that stopped part way last visit, and the folder it read if the
  // browser kept a handle to it
  // (with `cloud.resilient_import` the shell's carry-on check owns this offer instead)
  const [marker, setMarker] = useState(() => (progressive && !flagOn('cloud.resilient_import') ? readImportMarker(workspaceId) : null));
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
  // load the fingerprinting code now, so going offline later never fails every file
  useEffect(() => { if (flagOn('cloud.resilient_import')) preloadImportCode(); }, []);
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
    if (flagOn('cloud.resilient_import')) {
      // the same files picked again carry on the interrupted import: done files are skipped
      startImport({ request, openStore, workspaceId, importer }, source, { folder, kind: folder ? 'folder' : 'files', resume: readImportMarker(workspaceId) });
      return;
    }
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
      if ((error as Error).name !== 'AbortError') {
        setProblem(flagOn('cloud.resilient_import') ? 'SelectaDJ could not open that folder. Try again, or choose songs instead.' : (error as Error).message);
      }
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
    if (flagOn('cloud.resilient_import')) { void deleteImportJournal(workspaceId); dropResumeOffer(); }
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
  const checked = checkedOf(live);
  const failures = live.failures;
  const shownProblem = problem || (live.phase === 'failed' ? live.error || 'The import stopped. Songs already added are still in your library.' : '');
  const offer = progressive && live.phase === 'idle' && marker && recalled !== undefined;
  const folderName = marker?.folder ?? recalled?.name;
  const folders = picker.supported || folderInput.supported;
  const pickFolder = () => (picker.supported ? void chooseFolder() : (folderInput.supported ? folderPick : songsPick).current?.click());
  const pickSongs = () => songsPick.current?.click();
  useImperativeHandle(ref, () => ({ chooseFolder: pickFolder, chooseSongs: pickSongs, folders }));
  // a finished import's result can be put away; a new result shows again
  const [dismissed, setDismissed] = useState<ImportSummary | null>(null);
  const result = (live.phase === 'finished' || live.phase === 'paused') && live.summary && live.summary !== dismissed ? live.summary : null;

  // the pickers are always in the page, so a header button (or a test) can reach them
  const inputs = (
    <>
      {!picker.supported && folderInput.supported && <input ref={folderPick} type="file" hidden tabIndex={-1} aria-hidden="true" multiple {...{ webkitdirectory: '' }} onChange={chosen} />}
      <input ref={songsPick} type="file" hidden tabIndex={-1} aria-hidden="true" multiple accept="audio/*" onChange={chosen} />
    </>
  );
  const buttons = !running && (
    <div className="lw-connect-actions">
      {folders && <button type="button" className="primary" onClick={pickFolder}><Icon name="folder" size="toolbar" />Choose a folder</button>}
      <button type="button" className={folders ? undefined : 'primary'} onClick={pickSongs}><Icon name="music" size="toolbar" />Choose songs</button>
    </div>
  );
  const progress = running && (
    <section className="lw-import" aria-label="Adding your music">
      <div className="lw-import-head">
        <span className="lw-import-mark" aria-hidden="true"><Icon name="music" /></span>
        <div>
          <strong>{(live.resumed ?? 0) > 0 ? 'Carrying on adding your music' : 'Adding your music'}</strong>
          <span className="lw-import-count">{checkedWords(live)}</span>
        </div>
        <CancelImportButton label="Stop" className="quiet" />
      </div>
      <Meter label="Files checked" showLabel={false} value={typeof live.total === 'number' ? checked : undefined} max={Math.max(live.total ?? 1, 1)} valueText={checkedWords(live)} />
      {resilient && (live.waiting || live.elsewhere) && <ImportProgressLine live={live} className="lw-import-wait" />}
      <p className="lw-import-next">
        {resilient && !live.elsewhere && !live.read
          ? `Songs appear in your library as they are checked, so you can keep using SelectaDJ. If this tab closes, it carries on from ${formatCount(checked)} next time.`
          : 'Songs appear in your library as they are checked, so you can keep using SelectaDJ.'}
      </p>
    </section>
  );
  const notices = (
    <>
      {resilient && !running && <ResumeOfferNotice workspaceId={workspaceId} onChoose={pickFolder} onForget={forget} />}
      {offer && recalled && !refused && (
        <div className="banner" data-tone="warn" role="note">
          <Icon name="pause" size="toolbar" />
          <p>{`Adding ${folderName} was interrupted. Songs already added are in your library.`}</p>
          
            <button className="primary" onClick={() => void keepChecking(recalled)}>{`Carry on with ${folderName}`}</button>
            <button className="quiet" onClick={forget}>Forget this</button>
          
        </div>
      )}
      {offer && refused && <p className="banner" data-tone="danger" role="alert">The browser did not allow it. Choose the folder again.</p>}
      {offer && !recalled && !refused && (
        <div className="banner" data-tone="warn" role="note">
          <Icon name="pause" size="toolbar" />
          <p>Adding your music stopped part way last time. Choose the same folder or songs again and SelectaDJ carries on; nothing is added twice.</p>
          <button type="button" className="primary" onClick={pickFolder}>{folders ? 'Choose the folder again' : 'Choose the songs again'}</button>
        </div>
      )}
      {progress}
      {result && (
        <div className="banner" data-tone={result.paused ? 'warn' : 'ok'} role="status">
          <Icon name={result.paused ? 'pause' : 'check'} size="toolbar" />
          <p>{summaryWords(result)}</p>
          <button type="button" className="quiet" onClick={() => setDismissed(result)}>Dismiss</button>
        </div>
      )}
      {shownProblem && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="warning" size="toolbar" />
          <p className="error">{shownProblem}</p>
          {resilient && live.phase === 'failed' && <button type="button" className="primary" onClick={carryOnNow}>Try again</button>}
        </div>
      )}
      {degraded && <p className="banner" data-tone="warn" role="note"><Icon name="warning" size="toolbar" /><span>This browser is not keeping your list of connected songs, so you will need to choose them again next visit.</span></p>}
      {failures.length > 0 && (
        <details className="lw-disclosure" open={failures.length <= 5}>
          <summary>{countOf(failures.length, 'file')} could not be added</summary>
          <ul>
            {failures.map((failure, index) => <li key={`${failure.name}-${index}`}><b dir="auto">{failure.name}</b><span>{failure.reason}</span></li>)}
          </ul>
        </details>
      )}
      {lapsed.length > 0 && (
        <details className="lw-disclosure" open={lapsed.length <= 5} aria-labelledby="connect-music-lapsed">
          <summary id="connect-music-lapsed">{lapsed.length === 1 ? '1 song needs your permission again' : `${formatCount(lapsed.length)} songs need your permission again`}</summary>
          <p className="hint">Browsers forget file permissions between visits. Allow a song to play it here again.</p>
          <ul>
            {lapsed.map((item) => (
              <li key={item.songId}>
                <b dir="auto">{item.title}</b>
                <span>{item.why === 'permission' ? 'Needs permission' : item.why === 'changed' ? 'The file has changed' : 'File not found'}</span>
                {regranted[item.songId]
                  ? <span role="status">{regranted[item.songId]}</span>
                  : <button onClick={() => void allow(item)}>{item.why === 'permission' ? 'Allow' : item.why === 'changed' ? 'Check file' : 'Look again'}</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );

  if (variant === 'status') {
    return <div className="lw-connect-status connect-music">{inputs}{notices}</div>;
  }
  if (variant === 'hero') {
    return (
      <section className="empty-state boxed lw-hero connect-music" aria-labelledby="connect-music-title">
        <span className="empty-state-icon" aria-hidden="true"><Icon name="music" /></span>
        <h2 id="connect-music-title">Add your music</h2>
        <p>Choose the folder your songs are in and SelectaDJ turns them into mixes. Your files stay on this device; nothing is uploaded.</p>
        {buttons}
        {inputs}
        {!folders && <p className="hint">This browser cannot pick a whole folder, so choose the songs themselves.</p>}
        <div className="lw-hero-status">{notices}</div>
      </section>
    );
  }
  return (
    <section className="ui-card connect-music" aria-labelledby="connect-music-title">
      <div className="ui-card-head">
        <div>
          <h2 className="section-title" id="connect-music-title">Add music</h2>
          <p className="section-lead">Your files stay on this device. SelectaDJ keeps only each song’s title, artist and a fingerprint.</p>
        </div>
        {buttons}
      </div>
      {inputs}
      {!picker.supported && <p className="hint">{picker.reason}</p>}
      {notices}
    </section>
  );
});
