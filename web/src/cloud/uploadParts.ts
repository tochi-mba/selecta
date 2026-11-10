import { sha256 } from '@noble/hashes/sha2.js';
import type { Api } from './api';

// Uploads, the parts that aren't drawing (docs/saas/05-storage-uploads-playback.md §5.2).
//
// Every upload is multipart, in fixed parts the server chose. The server remembers each
// session and which parts reached storage, so an upload survives a refresh or a closed tab: the
// page lists unfinished sessions from the server, and choosing the same file again (same
// SHA-256, same size) carries on from the parts already uploaded instead of starting over.
// A browser can't keep the file itself across a reload without being asked, so the person
// chooses it again; nothing already sent is sent twice.

export type UploadSession = { id: string; name: string; size: number; sha256?: string | null; part_size: number; part_count: number; status: string };
export type UploadEntry = { index: number; name: string; refused: string | null; duplicate_of: string | null; same_as: string | null; session: UploadSession | null };
export type UploadStatus = { upload: { id: string; name: string; size: number; status: string; error: string | null }; uploaded_parts: { number: number; etag: string; size: number }[] };

/** Session states that can still take parts. */
export const RESUMABLE = new Set(['planned', 'uploading']);

export async function fileSha256(file: Blob) {
  const hash = sha256.create();
  const chunkSize = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    hash.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The server's unfinished sessions, newest first. */
export async function unfinishedUploads(api: Api, workspaceId: string): Promise<UploadSession[]> {
  const listed = await api<{ uploads: UploadSession[] }>('/uploads', {}, workspaceId);
  return listed.uploads.filter((session) => RESUMABLE.has(session.status));
}

/** An unfinished session this file can carry on. */
export function resumableFor(sessions: UploadSession[], file: { size: number; sha256: string }) {
  return sessions.find((session) => session.size === file.size && session.sha256 === file.sha256) ?? null;
}

/** Send the parts the server doesn't have yet, then ask it to finish. `onPart` hears each part
 * as it lands, with how many are done of how many. */
export async function sendParts(
  api: Api,
  workspaceId: string,
  file: Blob,
  session: UploadSession,
  onPart: (done: number, total: number, resumedFrom: number) => void = () => {},
  fetchImpl: typeof fetch = fetch,
) {
  const current = await api<UploadStatus>(`/uploads/${session.id}`, {}, workspaceId);
  const finished = new Set(current.uploaded_parts.map((part) => part.number));
  const resumedFrom = finished.size;
  let done = finished.size;
  onPart(done, session.part_count, resumedFrom);
  for (let number = 1; number <= session.part_count; number += 1) {
    if (finished.has(number)) continue;
    const urls = await api<{ part_urls: Record<string, string> }>(`/uploads/${session.id}/parts`, { method: 'POST', body: JSON.stringify({ part_numbers: [number] }) }, workspaceId);
    const start = (number - 1) * session.part_size;
    const response = await fetchImpl(urls.part_urls[String(number)], { method: 'PUT', body: file.slice(start, Math.min(start + session.part_size, file.size)) });
    if (!response.ok) throw new Error(`Part ${number} didn’t upload. Choose the file again to carry on.`);
    done += 1;
    onPart(done, session.part_count, resumedFrom);
  }
  return api<{ status: string; error?: string }>(`/uploads/${session.id}/complete`, { method: 'POST' }, workspaceId);
}
