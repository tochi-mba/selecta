import type { Api } from './api';
import { fileSha256 as identitySha256 } from '../media/identity';

// Uploads, the parts that aren't drawing (docs/saas/05-storage-uploads-playback.md §5.2).
//
// Every upload is multipart, in fixed parts the server chose. The server remembers each
// session and which parts reached storage, so an upload survives a refresh or a closed tab: the
// page lists unfinished sessions from the server, and choosing the same file again (same
// SHA-256, same size) carries on from the parts already uploaded instead of starting over.
// A browser can't keep the file itself across a reload without being asked, so the person
// chooses it again; nothing already sent is sent twice.

export type UploadSession = {
  id: string; name: string; size: number; sha256?: string | null; part_size: number; part_count: number; status: string;
  /** `storage.upload_identity`: the catalogue song an upload named, and when its storage hold lapses
   * (epoch seconds). */
  song_id?: number; expires_at?: number | null;
};
export type UploadEntry = { index: number; name: string; refused: string | null; duplicate_of: string | null; same_as: string | null; session: UploadSession | null; refusal_code?: string };
export type UploadStatus = { upload: { id: string; name: string; size: number; status: string; error: string | null; song_id?: number }; uploaded_parts: { number: number; etag: string; size: number }[] };
/** What `/complete` answers. */
export type UploadDone = { status: string; error?: string | null; asset_id?: string | null; rejection_code?: string; upload?: { song_id?: number } };

/** How `sendParts` paces itself (`cloud.move_to_cloud`); left out, one part at a time as always. */
export type SendOptions = {
  /** How many parts may be on their way at once, asked before each part starts. */
  inFlight?: () => number;
  /** Stops sending: parts on their way are dropped and nothing is completed. */
  signal?: AbortSignal;
};

/** Session states that can still take parts. */
export const RESUMABLE = new Set(['planned', 'uploading']);

/** The upload's SHA-256, the same digest the import uses (media/identity.ts): WebCrypto off the page
 * for a file that fits, and otherwise a streamed hash that yields between small slices, so hashing
 * an upload never holds the page for a third of a second at a time. */
export async function fileSha256(file: Blob) {
  return identitySha256(file);
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

/** How long one part may take to send: two minutes, or the time at about 25 KB a second for a big
 * part, whichever is longer. */
export function partLimitMs(bytes: number): number {
  return Math.max(120_000, Math.ceil(bytes / 25_000) * 1000);
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
  options: SendOptions = {},
) {
  const { signal } = options;
  const stopped = () => { if (signal?.aborted) throw new DOMException('The upload was stopped.', 'AbortError'); };
  const current = await api<UploadStatus>(`/uploads/${session.id}`, {}, workspaceId);
  const finished = new Set(current.uploaded_parts.map((part) => part.number));
  const resumedFrom = finished.size;
  let done = finished.size;
  onPart(done, session.part_count, resumedFrom);
  const one = async (number: number) => {
    const urls = await api<{ part_urls: Record<string, string> }>(`/uploads/${session.id}/parts`, { method: 'POST', body: JSON.stringify({ part_numbers: [number] }) }, workspaceId);
    stopped();
    const start = (number - 1) * session.part_size;
    const body = file.slice(start, Math.min(start + session.part_size, file.size));
    // A connection that goes silent mid-part (no reset, just nothing) left "Uploading" on screen
    // for ever. Past a limit generous for a slow line the part counts as not sent; the parts
    // already sent stay sent, so choosing the file again carries on from here.
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const limit = controller ? setTimeout(() => controller.abort(), partLimitMs(body.size)) : undefined;
    const stop = () => controller?.abort();
    signal?.addEventListener('abort', stop);
    let response: Response;
    try {
      response = await fetchImpl(urls.part_urls[String(number)], { method: 'PUT', body, ...(controller ? { signal: controller.signal } : {}) });
    } catch (problem) {
      stopped();
      if (controller?.signal.aborted) throw new Error(`Part ${number} didn’t upload. Choose the file again to carry on.`);
      throw problem;
    } finally {
      if (limit !== undefined) clearTimeout(limit);
      signal?.removeEventListener('abort', stop);
    }
    if (!response.ok) throw new Error(`Part ${number} didn’t upload. Choose the file again to carry on.`);
    done += 1;
    onPart(done, session.part_count, resumedFrom);
  };
  // One part at a time unless the caller allows more; the first failure stops new parts, lets
  // those on their way end, and is thrown.
  const going = new Set<Promise<void>>();
  let failure: { problem: unknown } | null = null;
  for (let number = 1; number <= session.part_count; number += 1) {
    if (finished.has(number)) continue;
    while (going.size >= Math.max(1, options.inFlight?.() ?? 1)) await Promise.race(going);
    if (failure) break;
    stopped();
    const sending: Promise<void> = one(number).catch((problem) => { failure ??= { problem }; }).finally(() => { going.delete(sending); });
    going.add(sending);
  }
  await Promise.all(going);
  if (failure) throw (failure as { problem: unknown }).problem;
  stopped();
  return api<UploadDone>(`/uploads/${session.id}/complete`, { method: 'POST' }, workspaceId);
}
