import { useEffect, useRef, useState } from 'react';
import { dirPicker, fileSha256, runImport, type FileHandleLike, type MediaStore, type Request } from '../media';
import type { Api } from './api';
import { readCloudLibraryAssets, type CloudLibraryAsset } from './cloudLibraryMedia';
import { mediaDeviceId, registeredDeviceId } from './ConnectMusic';

type WritableFile = FileHandleLike & { createWritable(): Promise<FileSystemWritableFileStream> };
type Destination = { getFileHandle(name: string, options?: { create: boolean }): Promise<WritableFile> };

function restoreName(asset: CloudLibraryAsset): string {
  const leaf = asset.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  return `${asset.id}-${leaf || 'audio'}`;
}

async function existingFile(folder: Destination, name: string): Promise<WritableFile | null> {
  try {
    return await folder.getFileHandle(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function restoreFile(asset: CloudLibraryAsset, folder: Destination, api: Api, workspace: string, signal: AbortSignal) {
  const hash = asset.sha256?.toLowerCase();
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('The original could not be verified.');
  const name = restoreName(asset);
  for (const candidate of new Set([name, asset.name])) {
    if (candidate !== name && /[\\/]/.test(candidate)) continue;
    const existing = await existingFile(folder, candidate);
    if (existing && await fileSha256(await existing.getFile(), { signal }) === hash) return existing;
    if (existing && candidate === name && (await existing.getFile()).size > 0) throw new Error('A different file already uses the restore filename.');
  }
  const { url } = await api<{ url: string }>(`/assets/${encodeURIComponent(asset.id)}/playback-url`, { signal }, workspace);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('The original could not be downloaded.');
  if (!response.body) throw new Error('The browser could not stream the original.');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const digest = sha256.create();
  signal.throwIfAborted();
  const occupied = await existingFile(folder, name);
  if (occupied && (await occupied.getFile()).size > 0) throw new Error('A file already uses the restore filename.');
  const handle = await folder.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try {
    await response.body.pipeTo(new WritableStream<Uint8Array>({
      async write(chunk) {
        digest.update(chunk);
        await writer.write(Uint8Array.from(chunk));
      },
    }), { signal });
    const actual = Array.from(digest.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== hash) throw new Error('The downloaded file failed verification.');
    signal.throwIfAborted();
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
  return handle;
}

export function RestoreCloudLibrary({ api, workspaceId, request, openStore, refresh }: {
  api: Api;
  workspaceId: string;
  request: Request;
  openStore: () => Promise<MediaStore>;
  refresh: () => Promise<void>;
}) {
  const [assets, setAssets] = useState<CloudLibraryAsset[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void readCloudLibraryAssets(api, workspaceId).then((items) => {
      if (active) setAssets(items);
    }).catch(() => {
      if (active) setStatus('Could not check for cloud originals. Reload the Library to try again.');
    });
    return () => {
      active = false;
      operation.current?.abort();
    };
  }, [api, workspaceId]);

  const restore = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setBusy(true);
    setFailed([]);
    try {
      const picker = (window as unknown as { showDirectoryPicker(options: { mode: 'readwrite' }): Promise<Destination> });
      const folder = await picker.showDirectoryPicker({ mode: 'readwrite' });
      const files: WritableFile[] = [];
      const problems: string[] = [];
      for (const asset of assets) {
        signal.throwIfAborted();
        setStatus(`Checking ${files.length + problems.length + 1} of ${assets.length} originals…`);
        try {
          files.push(await restoreFile(asset, folder, api, workspaceId, signal));
        } catch (error) {
          signal.throwIfAborted();
          problems.push(`${asset.name} · ${error instanceof Error ? error.message : 'Could not save this file.'}`);
        }
      }
      setFailed(problems);
      if (!files.length) {
        setStatus('No originals could be restored to that folder.');
        return;
      }
      signal.throwIfAborted();
      setStatus('Connecting the verified files to your Library…');
      const result = await runImport({
        source: files, request, store: await openStore(), deviceId: mediaDeviceId(workspaceId),
        signal, reportDevice: () => registeredDeviceId(workspaceId),
      });
      if (signal.aborted) return;
      await refresh();
      const incomplete = result.paused || result.failed > 0 || result.skipped > 0 || problems.length > 0;
      setStatus(incomplete
        ? 'Some originals still need attention. Choose the same folder to retry without downloading verified files again.'
        : `${files.length} originals verified and connected on this device.`);
    } catch (error) {
      if (signal.aborted) {
        setStatus('Restore paused. Choose the same folder to continue with the remaining originals.');
      } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setStatus('The restore could not finish. Choose the same folder to pick up where you left off.');
      }
    } finally {
      operation.current = null;
      setBusy(false);
    }
  };

  if (!assets.length && !status) return null;
  return <section className="card" aria-label="Restore cloud music">
    <h2>Restore cloud music</h2>
    {assets.length > 0 && <p>Save your cloud originals on this device and connect them to your Library.</p>}
    {assets.length > 0 && (dirPicker().supported
      ? <button type="button" onClick={() => void restore()} disabled={busy}>Choose where to save music</button>
      : <p>Use Download my data in account settings, extract the original files, then choose Connect music in the Library.</p>)}
    {busy && <button type="button" onClick={() => operation.current?.abort()}>Pause restore</button>}
    {status && <p role="status">{status}</p>}
    {failed.length > 0 && <details><summary>{failed.length} originals need attention</summary>
      <ul>{failed.map((message, index) => <li key={index}>{message}</li>)}</ul>
    </details>}
  </section>;
}
