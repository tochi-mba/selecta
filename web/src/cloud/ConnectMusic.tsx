import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Request } from '../api';
import { dirPicker, directoryInput, findLapsed, runImport } from '../media';
import type { DirectoryHandleLike, ImportEvent, ImportSource, ImportSummary, LapsedItem, MediaStore, RegrantOutcome } from '../media';

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

export function summaryWords(summary: ImportSummary): string {
  const parts = [`${summary.imported} ${summary.imported === 1 ? 'song' : 'songs'} connected`];
  if (summary.duplicates) parts.push(`${summary.duplicates} already in your library`);
  if (summary.failed) parts.push(`${summary.failed} could not be read`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped as not music`);
  const words = parts.join(', ');
  if (summary.cancelled) return `Stopped. ${words} before you cancelled. Nothing else changed.`;
  if (summary.paused) return `Paused because browser storage is full. ${words} so far.`;
  return `${words}.`;
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

export function ConnectMusic({ request, workspaceId, openStore, onImported, importer = runImport }: {
  /** Asks with full /api paths, as the media importer does. */
  request: Request;
  workspaceId: string;
  openStore: () => Promise<MediaStore>;
  onImported: () => void;
  importer?: typeof runImport;
}) {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [problem, setProblem] = useState('');
  const [lapsed, setLapsed] = useState<LapsedItem[]>([]);
  const [regranted, setRegranted] = useState<Record<number, string>>({});
  const [degraded, setDegraded] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const picker = dirPicker();
  const folderInput = directoryInput();

  const checkLapsed = useCallback(async () => {
    try {
      const store = await openStore();
      setDegraded(store.degraded);
      setLapsed(await findLapsed(store));
    } catch { setLapsed([]); }
  }, [openStore]);
  useEffect(() => { void checkLapsed(); }, [checkLapsed]);
  useEffect(() => () => stopper.current?.abort(), []);

  const start = async (source: ImportSource) => {
    stopper.current?.abort();
    const controller = new AbortController();
    stopper.current = controller;
    setRows([]); setSummary(null); setProblem(''); setRunning(true);
    try {
      const store = await openStore();
      const done = await importer({
        source, request, store, deviceId: mediaDeviceId(workspaceId), signal: controller.signal,
        onProgress: (event) => setRows((current) => applyImportEvent(current, event)),
      });
      setSummary(done);
      setDegraded(store.degraded);
      if (done.imported || done.duplicates) onImported();
    } catch (error) {
      setProblem((error as Error).message || 'The import stopped. Nothing after the last connected song was changed.');
    } finally {
      setRunning(false);
      if (stopper.current === controller) stopper.current = null;
    }
  };

  const chooseFolder = async () => {
    try {
      const handle = await (window as unknown as { showDirectoryPicker(options?: { mode: 'read' }): Promise<DirectoryHandleLike> }).showDirectoryPicker({ mode: 'read' });
      await start(handle);
    } catch (error) {
      // closing the picker is a choice, not a failure
      if ((error as Error).name !== 'AbortError') setProblem((error as Error).message);
    }
  };
  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files?.length) void start(Array.from(files));
    event.target.value = '';
  };

  const allow = async (item: LapsedItem) => {
    const outcome = await item.regrant();
    setRegranted((current) => ({ ...current, [item.songId]: REGRANT_WORDS[outcome.status] }));
    if (outcome.status === 'recovered') onImported();
  };

  const finished = rows.filter((row) => row.stage === 'done' || row.stage === 'failed').length;
  const failures = rows.filter((row) => row.stage === 'failed');
  return (
    <section className="panel stack connect-music" aria-labelledby="connect-music-title">
      <h2 id="connect-music-title">Connect music</h2>
      <p className="hint">Your music stays on this device. SelectaDJ keeps only each song’s title, artist and a fingerprint, so your library and mixes work on your other devices.</p>
      {!running && (
        <div className="row wrap">
          {picker.supported && <button className="primary" onClick={() => void chooseFolder()}>Choose a folder</button>}
          {!picker.supported && folderInput.supported && (
            <label className="button primary">Choose a folder<input type="file" hidden multiple {...{ webkitdirectory: '' }} onChange={chosen} /></label>
          )}
          <label className="button">Choose songs<input type="file" hidden multiple accept="audio/*" onChange={chosen} /></label>
        </div>
      )}
      {!picker.supported && <p className="hint">{picker.reason}</p>}
      {degraded && <p className="hint" role="note">This browser is not keeping SelectaDJ’s list of connected files, so you will need to connect them again next visit.</p>}
      {running && (
        <div className="stack" role="status" aria-live="polite">
          <p><b>Connecting your music…</b> {finished} of {rows.length} {rows.length === 1 ? 'file' : 'files'} checked so far.</p>
          <progress max={Math.max(rows.length, 1)} value={finished} aria-label="Files checked" />
          <button onClick={() => stopper.current?.abort()}>Cancel</button>
        </div>
      )}
      {summary && <p role="status">{summaryWords(summary)}</p>}
      {problem && <p className="error" role="alert">{problem}</p>}
      {failures.length > 0 && (
        <details open={failures.length <= 5}>
          <summary>{failures.length} {failures.length === 1 ? 'file' : 'files'} could not be connected</summary>
          <ul>
            {failures.map((row, index) => <li key={`${row.name}-${index}`}><b dir="auto">{row.name}</b>: {row.reason}</li>)}
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
                <span className="hint">{item.why === 'permission' ? 'Needs permission' : 'File not found'}</span>
                {regranted[item.songId]
                  ? <span role="status">{regranted[item.songId]}</span>
                  : <button onClick={() => void allow(item)}>{item.why === 'permission' ? 'Allow' : 'Look again'}</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
