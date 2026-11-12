import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import type { Api } from './api';
import { fileSha256, resumableFor, sendParts, unfinishedUploads, UploadEntry, UploadSession, UploadStatus } from './uploadParts';

type Item = { name: string; status: string; detail?: string };

// Add music: choose files, upload them in parts, and carry on an unfinished upload after a
// refresh by choosing the same file again. While the account is over its storage limit the
// panel says why and uploading waits (`blocked`); the server refuses it anyway.

export function UploadsPanel({ api, workspaceId, setError, setNotice, blocked, onAccepted }: {
  api: Api;
  workspaceId: string;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  blocked: string | null;
  onAccepted?: () => void;
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
      next.push({ name, status: result.status === 'accepted' ? 'Upload accepted' : result.status, detail: result.error ?? undefined });
      if (result.status === 'accepted') onAccepted?.();
    } catch (problem) {
      next.push({ name, status: 'Needs attention', detail: (problem as Error).message });
    }
  };

  const begin = async () => {
    if (!files.length || blocked) return;
    setUploading(true); setError(''); setNotice(''); setItems([]);
    const next: Item[] = [];
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
        for (const entry of planned.uploads) {
          if (entry.refused) { next.push({ name: entry.name, status: 'Skipped', detail: entry.refused }); continue; }
          let session = entry.session;
          const file = fresh[entry.index]?.file;
          if (!session || !file) continue;
          if (entry.duplicate_of && !window.confirm(`${entry.name} already exists in your library. Keep another copy anyway?`)) {
            await api(`/uploads/${session.id}`, { method: 'DELETE' }, workspaceId);
            next.push({ name: entry.name, status: 'Skipped', detail: 'A matching copy is already in your library.' });
            setItems([...next]);
            continue;
          }
          if (entry.same_as) {
            await api(`/uploads/${session.id}`, { method: 'DELETE' }, workspaceId);
            const resumed = await api<UploadStatus>(`/uploads/${entry.same_as}`, {}, workspaceId);
            if (resumed.upload.status === 'accepted') {
              next.push({ name: entry.name, status: 'Already in your library', detail: 'This file matches another upload in this batch.' });
              setItems([...next]);
              continue;
            }
            session = { ...session, id: entry.same_as, status: resumed.upload.status };
          }
          await send(file, session, entry.name, next);
          setItems([...next]);
        }
      }
      setItems([...next]);
      setNotice('Upload finished. If anything was interrupted, choose the same file again to carry on.');
    } catch (problem) { setError((problem as Error).message); }
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
      {items.length > 0 && <ul className="cloud-upload-list">{items.map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><b>{item.status}</b>{item.detail && <small>{item.detail}</small>}</li>)}</ul>}
    </section>
  );
}
