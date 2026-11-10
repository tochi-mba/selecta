import { ChangeEvent, useEffect, useState } from 'react';
import { Action, Dialog } from '../ui/controls';
import { words } from '../copy';

type Preview = {
  token: string;
  created_utc: string;
  counts: { songs: number; drafts: number; ratings: number };
  replaces: string;
  skips: string;
};
type BackupStatus = { pending_restart: boolean; rollback_available: boolean; problem?: string | null };

async function backupRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch('/api/backup' + path, init);
  if (!response.ok) {
    let message = 'Could not work with this backup.';
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') message = data.detail;
    } catch { /* unavailable body */ }
    throw new Error(message);
  }
  return response;
}

/** Backups contain local paths and user history. Neither the ZIP nor its contents
 * are uploaded to any external service; the destination is the local Selecta API. */
export function LocalBackup() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [issue, setIssue] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    void backupRequest('/status').then((response) => response.json()).then((next: BackupStatus) => {
      if (live) setStatus(next);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const download = async () => {
    setWorking(true); setIssue(''); setNotice('');
    try {
      const response = await backupRequest('');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'selecta-local-backup.zip';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice('Backup downloaded. Keep it somewhere safe. It contains your song paths and preferences, but not your audio.');
    } catch (error) {
      setIssue((error as Error).message);
    } finally { setWorking(false); }
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    setChosen(event.target.files?.[0] ?? null);
    setPreview(null); setIssue(''); setNotice('');
  };

  const inspect = async () => {
    if (!chosen) return;
    setWorking(true); setIssue(''); setPreview(null);
    try {
      const response = await backupRequest('/preview', {
        method: 'POST', headers: { 'content-type': 'application/zip' }, body: chosen,
      });
      setPreview(await response.json() as Preview);
    } catch (error) { setIssue((error as Error).message); }
    finally { setWorking(false); }
  };

  const confirm = async () => {
    if (!chosen || !preview) return;
    setWorking(true); setIssue('');
    try {
      await backupRequest('/stage', {
        method: 'POST',
        headers: { 'content-type': 'application/zip', 'x-backup-token': preview.token },
        body: chosen,
      });
      setStatus((current) => ({ pending_restart: true, rollback_available: current?.rollback_available ?? false }));
      setNotice(words().restorePrepared);
      setChosen(null); setPreview(null);
    } catch (error) {
      setIssue((error as Error).message);
      setPreview(null); // stale archive or edited file must be checked again
    } finally { setWorking(false); }
  };

  return <section className="panel stack">
    <h2>Local data backup</h2>
    <p>Save your library records, drafts, feedback and preferences in a verified ZIP. Original music, audio caches and exports are not included; keep those files separately.</p>
    <Action working="Preparing download…" disabled={working} run={download}>Download a backup</Action>
    {status?.pending_restart && <p className="warn" role="status">A validated restore is waiting for a restart. No running data has been replaced yet.</p>}
    {status?.rollback_available && <p className="hint">A pre-restore database rollback is preserved locally.</p>}
    {status?.problem && <p className="warn" role="alert">Restore was not applied: {status.problem}. Your current database has been kept.</p>}
    <h3>Restore a backup</h3>
    <p className="hint">Restoring replaces the current local database at the next restart. It cannot reconstruct music files that have moved or vanished.</p>
    <label>Choose a Selecta backup ZIP
      <input type="file" accept=".zip,application/zip" onChange={selectFile} disabled={working} />
    </label>
    {chosen && <Action disabled={working} working="Checking archive…" run={inspect}>Validate and preview restore</Action>}
    {issue && <p className="warn" role="alert">{issue}</p>}
    {notice && <p role="status">{notice}</p>}
    {preview && <Dialog title="Replace local data on next restart?" onClose={() => setPreview(null)}
      footer={<>
        <button onClick={() => setPreview(null)}>Cancel - keep current data</button>
        <Action className="primary" working="Preparing restore…" disabled={working} run={confirm}>Confirm staged restore</Action>
      </>}>
      <p>Archive date: {preview.created_utc}</p>
      <p>This archive contains {preview.counts.songs} songs, {preview.counts.drafts} drafts, and {preview.counts.ratings} ratings.</p>
      <p><b>Will replace:</b> {preview.replaces}.</p>
      <p><b>Will not replace:</b> {preview.skips}.</p>
      <p className="warn">Your currently saved drafts, feedback and library records will be replaced after you restart the app. Original audio files remain untouched. Keep a fresh backup of your current data before proceeding.</p>
    </Dialog>}
  </section>;
}
