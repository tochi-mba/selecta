import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import type { Api } from './api';
import { completeOutcome, completeStatusWords, uploadSummary, UploadResult, withUnreached } from './libraryState';
import { fileSha256, resumableFor, sendParts, unfinishedUploads, UploadEntry, UploadSession, UploadStatus } from './uploadParts';

type Item = UploadResult;

// Add music: choose files, upload them in parts, and carry on an unfinished upload after a
// refresh by choosing the same file again. While the account is over its storage limit the
// panel says why and uploading waits (`blocked`); the server refuses it anyway.
//
// `perFile` (`cloud.library_states`, ADR-0421 AV-0421-03): every chosen file ends with its own
// outcome (added, already there, skipped, needs attention, not uploaded), one file's failure
// doesn't stop the rest, and the closing message counts them instead of one "Upload finished".

export function UploadsPanel({ api, workspaceId, setError, setNotice, blocked, onAccepted, perFile = true }: {
  api: Api;
  workspaceId: string;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  blocked: string | null;
  onAccepted?: () => void;
  perFile?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [unfinished, setUnfinished] = useState<UploadSession[]>([]);
  const selected = useCallback((event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? [])), []);

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
        const planned = await api<{ uploads: UploadEntry[] }>('/uploads/plan', { method: 'POST', body: JSON.stringify({ files: fresh.map((item) => item.spec) }) }, workspaceId);
        const one = async (entry: UploadEntry) => {
          if (entry.refused) { next.push({ name: entry.name, status: 'Skipped', detail: entry.refused, outcome: 'skipped' }); return; }
          let session = entry.session;
          const file = fresh[entry.index]?.file;
          if (!session || !file) {
            if (perFile) next.push({ name: entry.name, status: 'Needs attention', detail: 'SelectaDJ couldn’t start this upload. Choose the file again to try once more.', outcome: 'failed' });
            return;
          }
          if (entry.duplicate_of && !window.confirm(`${entry.name} already exists in your library. Keep another copy anyway?`)) {
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
      <div className="cloud-upload-intro"><p className="cloud-eyebrow">PRIVATE LIBRARY</p><h2>Add your tracks</h2><p>Files transfer directly to private object storage. SelectaDJ checks the actual audio format, file size and duration before accepting an upload.</p></div>
      {blocked && <p className="cloud-inline-error" role="status">{blocked}</p>}
      {unfinished.length > 0 && (
        <section className="cloud-unfinished" aria-label="Unfinished uploads">
          <h3>Unfinished uploads</h3>
          <p>Choose the same file again and SelectaDJ carries on from where it stopped.</p>
          <ul>{unfinished.map((session) => <li key={session.id}><span>{session.name}</span><small>{session.part_count} {session.part_count === 1 ? 'part' : 'parts'}</small></li>)}</ul>
        </section>
      )}
      <label className={`cloud-drop${blocked ? ' disabled' : ''}`}>
        <input type="file" multiple disabled={Boolean(blocked)} accept="audio/*,.aiff,.aif,.flac,.mp3,.m4a,.wav,.ogg,.opus" onChange={selected} />
        <span className="cloud-drop-icon">＋</span>
        <strong>{files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} selected` : 'Choose music files'}</strong>
        <small>MP3, FLAC, WAV, AIFF, M4A, AAC and Ogg audio</small>
      </label>
      <div className="cloud-upload-actions">
        <button className="primary" disabled={!files.length || uploading || Boolean(blocked)} onClick={() => void begin()}>{uploading ? 'Uploading…' : 'Start upload'}</button>
        {progress && <span role="status">{progress}</span>}
      </div>
      {items.length > 0 && <ul className="cloud-upload-list" aria-label={perFile ? 'Each file’s result' : undefined}>{items.map((item, index) => <li key={`${item.name}-${index}`} data-outcome={perFile ? item.outcome : undefined}><span>{item.name}</span><b>{item.status}</b>{item.detail && <small>{item.detail}</small>}</li>)}</ul>}
    </section>
  );
}
