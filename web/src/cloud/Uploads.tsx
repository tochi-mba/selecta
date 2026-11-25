import { ChangeEvent, CSSProperties, DragEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { feelOn, feelParts, onFeelChange } from '../feel/root';
import { Icon } from '../ui/Icon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { countOf, Truncate } from '../ui/format';
import type { Api } from './api';
import { completeOutcome, completeStatusWords, uploadSummary, UploadResult, withUnreached } from './libraryState';
import { fileSha256, resumableFor, sendParts, unfinishedUploads, UploadEntry, UploadSession, UploadStatus } from './uploadParts';
import { UnfinishedUploads } from './UnfinishedUploads';

type Item = UploadResult;

// Add music: choose files, upload them in parts, and carry on an unfinished upload after a
// refresh by choosing the same file again. While the account is over its storage limit the
// panel says why and uploading waits (`blocked`); the server refuses it anyway.
//
// `perFile` (`cloud.library_states`, ADR-0421 AV-0421-03): every chosen file ends with its own
// outcome (added, already there, skipped, needs attention, not uploaded), one file's failure
// doesn't stop the rest, and the closing message counts them instead of one "Upload finished".

export function UploadsPanel({ api, workspaceId, setError, setNotice, blocked, onAccepted, perFile = true, venueId }: {
  api: Api;
  workspaceId: string;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  blocked: string | null;
  onAccepted?: () => void;
  perFile?: boolean;
  /** A business venue the files are for (ADR-0448 per-venue storage); none for the whole library. */
  venueId?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [unfinished, setUnfinished] = useState<UploadSession[]>([]);
  // A duplicate's question waits for an answer in the shared dialog, never the browser's own prompt.
  const [question, setQuestion] = useState<string | null>(null);
  const answer = useRef<((keep: boolean) => void) | null>(null);
  const ask = (name: string) => new Promise<boolean>((resolve) => {
    answer.current = resolve;
    setQuestion(name);
  });
  const answered = (keep: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setQuestion(null);
    resolve?.(keep);
  };
  const [rights, setRights] = useState<string | null>(null);
  const rightsAnswer = useRef<((yes: boolean) => void) | null>(null);
  const askRights = (statement: string) => new Promise<boolean>((resolve) => {
    rightsAnswer.current = resolve;
    setRights(statement);
  });
  const answeredRights = (yes: boolean) => {
    const resolve = rightsAnswer.current;
    rightsAnswer.current = null;
    setRights(null);
    resolve?.(yes);
  };
  const selected = useCallback((event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? [])), []);
  // The drop zone always takes the files dropped on it (the browser never opens them instead), the
  // same way the picker does. Only the look of a file dragged over it (lifted, with a lit edge)
  // waits for a part of the feel to be on.
  const feeling = useSyncExternalStore(onFeelChange, () => feelParts().length > 0, () => false);
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  const [dragging, setDragging] = useState(false);
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const dragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (blocked || !carriesFiles(event)) return;
    event.preventDefault();
    if (feeling && !dragging) setDragging(true);
  };
  const dragLeave = (event: DragEvent<HTMLLabelElement>) => {
    // leaving for a child of the zone is not leaving the zone
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const dropped = (event: DragEvent<HTMLLabelElement>) => {
    setDragging(false);
    if (!carriesFiles(event)) return;
    // a blocked zone still keeps the browser from opening the file, but takes nothing
    event.preventDefault();
    if (blocked) return;
    setFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const loadUnfinished = useCallback(async () => {
    try { setUnfinished(await unfinishedUploads(api, workspaceId)); } catch { /* the list is a convenience */ }
  }, [api, workspaceId]);
  useEffect(() => { void loadUnfinished(); }, [loadUnfinished]);

  const send = async (file: File, session: UploadSession, name: string, next: Item[]) => {
    try {
      const result = await sendParts(api, workspaceId, file, session, (done, total, resumedFrom) => {
        setProgress(resumedFrom > 0
          ? `Carrying on ${file.name}: part ${Math.min(done + 1, total)} of ${total} (${resumedFrom} already uploaded)`
          : `Uploading ${file.name}: part ${Math.min(done + 1, total)} of ${total}`);
      });
      next.push(perFile
        ? { name, status: completeStatusWords(result.status), detail: result.error ?? undefined, outcome: completeOutcome(result.status) }
        : { name, status: result.status === 'accepted' ? 'Upload accepted' : result.status, detail: result.error ?? undefined });
      if (result.status === 'accepted') onAccepted?.();
    } catch (problem) {
      next.push({ name, status: 'Needs attention', detail: (problem as Error).message, outcome: 'failed' });
    }
  };

  const begin = async () => {
    if (!files.length || blocked) return;
    setUploading(true); setError(''); setNotice(''); setItems([]);
    const next: Item[] = [];
    const chosen = files.map((file) => file.name);
    try {
      const pending = await unfinishedUploads(api, workspaceId).catch(() => [] as UploadSession[]);
      const fresh: { file: File; spec: { name: string; size: number; content_type?: string; sha256: string } }[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setProgress(`Checking ${index + 1} of ${files.length}`);
        const digest = await fileSha256(file);
        const earlier = resumableFor(pending, { size: file.size, sha256: digest });
        if (earlier) {
          await send(file, earlier, file.name, next);
          setItems([...next]);
        } else {
          fresh.push({ file, spec: { name: file.name, size: file.size, content_type: file.type || undefined, sha256: digest } });
        }
      }
      if (fresh.length) {
        const plan = (headers?: Record<string, string>) => api<{ uploads: UploadEntry[] }>('/uploads/plan', { method: 'POST', body: JSON.stringify({ files: fresh.map((item) => item.spec), ...(venueId ? { venue_id: venueId } : {}) }), headers }, workspaceId);
        let planned: { uploads: UploadEntry[] };
        try {
          planned = await plan();
        } catch (problem) {
          // A business organisation asks for the upload rights statement first (ADR-0449
          // BZ-0449-04): confirm it for this batch, then plan again naming the batch.
          const detail = attestationAsked(problem);
          if (!detail || !(await askRights(detail.statement))) throw problem;
          const batch = await api<{ batch_id: string }>('/business/uploads/attestation', { method: 'POST', body: JSON.stringify({ file_count: fresh.length, statement_version: detail.statement_version, attested: true }) }, workspaceId);
          planned = await plan({ 'X-Upload-Batch': batch.batch_id });
        }
        const one = async (entry: UploadEntry) => {
          if (entry.refused) { next.push({ name: entry.name, status: 'Skipped', detail: entry.refused, outcome: 'skipped' }); return; }
          let session = entry.session;
          const file = fresh[entry.index]?.file;
          if (!session || !file) {
            if (perFile) next.push({ name: entry.name, status: 'Needs attention', detail: 'SelectaDJ couldn’t start this upload. Choose the file again to try once more.', outcome: 'failed' });
            return;
          }
          if (entry.duplicate_of && !(await ask(entry.name))) {
            await api(`/uploads/${session.id}`, { method: 'DELETE' }, workspaceId);
            next.push({ name: entry.name, status: 'Skipped', detail: 'A matching copy is already in your library.', outcome: 'skipped' });
            setItems([...next]);
            return;
          }
          if (entry.same_as) {
            await api(`/uploads/${session.id}`, { method: 'DELETE' }, workspaceId);
            const resumed = await api<UploadStatus>(`/uploads/${entry.same_as}`, {}, workspaceId);
            if (resumed.upload.status === 'accepted') {
              next.push({ name: entry.name, status: 'Already in your library', detail: 'This file matches another upload in this batch.', outcome: 'already' });
              setItems([...next]);
              return;
            }
            session = { ...session, id: entry.same_as, status: resumed.upload.status };
          }
          await send(file, session, entry.name, next);
          setItems([...next]);
        };
        for (const entry of planned.uploads) {
          if (!perFile) { await one(entry); continue; }
          // One file's trouble (a refused cancel, a lost status) is that file's outcome only.
          try { await one(entry); } catch (problem) {
            next.push({ name: entry.name, status: 'Needs attention', detail: (problem as Error).message, outcome: 'failed' });
            setItems([...next]);
          }
        }
      }
      if (perFile) {
        const all = withUnreached(next, chosen, 'SelectaDJ didn’t get to this file. Choose it again to upload it.');
        setItems(all);
        setNotice(uploadSummary(all).text);
      } else {
        setItems([...next]);
        setNotice('Upload finished. If anything was interrupted, choose the same file again to carry on.');
      }
    } catch (problem) {
      setError((problem as Error).message);
      if (perFile) {
        // The batch stopped (the plan itself was refused, say): every file still gets its line.
        const all = withUnreached(next, chosen, `Not uploaded: ${(problem as Error).message}`);
        setItems(all);
        setNotice(uploadSummary(all).text);
      }
    }
    finally { setUploading(false); setProgress(''); void loadUnfinished(); }
  };

  return (
    <section className="cloud-upload-panel">
      <div className="cloud-upload-intro"><p className="cloud-eyebrow">Private library</p><h2>Add your tracks</h2><p>Files transfer directly to private object storage. SelectaDJ checks the actual audio format, file size and duration before accepting an upload.</p></div>
      {blocked && <p className="cloud-inline-error" role="status">{blocked}</p>}
      <UnfinishedUploads api={api} workspaceId={workspaceId} sessions={unfinished} onChanged={() => void loadUnfinished()} />
      <label className={`cloud-drop${blocked ? ' disabled' : ''}`} data-lift={feeling && !blocked ? '' : undefined} data-drag={dragging || undefined} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropped}>
        <input type="file" multiple disabled={Boolean(blocked)} accept="audio/*,.aiff,.aif,.flac,.mp3,.m4a,.wav,.ogg,.opus" onChange={selected} />
        <span className="cloud-drop-icon"><Icon name="plus" size="hero" /></span>
        <strong>{files.length ? `${countOf(files.length, 'file')} selected` : 'Choose music files'}</strong>
        <small>MP3, FLAC, WAV, AIFF, M4A, AAC and Ogg audio</small>
      </label>
      <div className="cloud-upload-actions">
        <button className="primary" disabled={!files.length || uploading || Boolean(blocked)} onClick={() => void begin()}>{uploading ? 'Uploading…' : 'Start upload'}</button>
        {progress && <span role="status">{progress}</span>}
      </div>
      {/* each file's line arrives as its upload ends, and an accepted one ticks (feel motion only) */}
      {items.length > 0 && <ul className="cloud-upload-list" aria-label={perFile ? 'Each file’s result' : undefined} data-stagger={moving || undefined}>{items.map((item, index) => <li key={`${item.name}-${index}`} data-outcome={perFile ? item.outcome : undefined} style={moving ? ({ '--i': index } as CSSProperties) : undefined}><Truncate text={item.name} /><b>{moving && item.outcome === 'added' && <UploadTick />}{item.status}</b>{item.detail && <small>{item.detail}</small>}</li>)}</ul>}
      {rights !== null && (
        <ConfirmDialog
          title="Confirm the upload rights"
          body={rights}
          confirmLabel="I confirm"
          cancelLabel="Don't upload"
          onConfirm={() => answeredRights(true)}
          onClose={() => answeredRights(false)}
        />
      )}
      {question !== null && (
        <ConfirmDialog
          title={`Keep another copy of ${question}?`}
          body={`${question} is already in your library. Another copy uses more of your storage.`}
          confirmLabel="Keep another copy"
          cancelLabel="Skip this file"
          onConfirm={() => answered(true)}
          onClose={() => answered(false)}
        />
      )}
    </section>
  );
}

/** The tick an accepted file's line draws once (.feel-tick). Decoration: the words say "accepted". */
function UploadTick() {
  return <svg className="cloud-upload-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

/** The upload rights statement a business organisation asks for, from a refused plan. */
export function attestationAsked(problem: unknown): { statement: string; statement_version: string } | null {
  const value = (problem ?? {}) as { code?: string; payload?: unknown };
  const payload = (value.payload ?? {}) as { detail?: unknown };
  const detail = (payload.detail ?? payload) as { code?: string; statement?: unknown; statement_version?: unknown };
  const code = value.code ?? detail.code;
  if (code !== 'upload_attestation_required' || typeof detail.statement !== 'string' || typeof detail.statement_version !== 'string') return null;
  return { statement: detail.statement, statement_version: detail.statement_version };
}
