import type { MediaStore, StoredSong } from '../media/store';
import { CloudError } from './api';

// Before uploading songs from this device to the cloud library (`cloud.move_to_cloud`, plan
// "two places" 6c, ADR-0489): what a batch would do, and the upload rights statement.
//
// Three requests, and only these: `GET` and `POST /api/uploads/rights` (has this workspace
// confirmed the statement's current wording, and confirming it) and `POST /api/uploads/preview`
// (the dry run: names, sizes, content hashes, song ids and lengths; never a path or a byte of
// audio). The upload queue (cloudUploadQueue.ts) asks `hasUploadConsent` before it starts and
// refuses without it. This module is never imported by the device-to-account modules.

/** Plain fetch with full /api paths, as ConnectMusic's `request` is. */
export type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export const RIGHTS_PATH = '/api/uploads/rights';
export const PREVIEW_PATH = '/api/uploads/preview';
/** The most files one dry run takes (`storage.uploads.MAX_BATCH`). */
export const PREVIEW_BATCH = 500;

/** `GET /api/uploads/rights`. `applies` is false for a business workspace, which keeps its own
 * statement and is never asked this one. */
export type UploadRights = {
  applies: boolean;
  reason: string | null;
  accepted: boolean;
  version: string | null;
  statement: string | null;
  wording_sha256: string | null;
  accepted_at: number | null;
};

export function readUploadRights(request: Request): Promise<UploadRights> {
  return request<UploadRights>(RIGHTS_PATH);
}

/** Confirm the wording `shown` (its version and hash), and nothing else: a page showing an older
 * wording is refused by the server (409 `stale_statement`) and must show the new one. */
export function acceptUploadRights(request: Request, shown: Pick<UploadRights, 'version' | 'wording_sha256'>): Promise<UploadRights> {
  return request<UploadRights>(RIGHTS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: shown.version, wording_sha256: shown.wording_sha256 }),
  });
}

/** Agree to the wording shown. When it changed while it was shown, the new wording comes back
 * unconfirmed, with `changed`, for the member to read. */
export async function agreeToRights(request: Request, shown: UploadRights): Promise<{ rights: UploadRights; changed: boolean }> {
  try {
    return { rights: await acceptUploadRights(request, shown), changed: false };
  } catch (error) {
    if (refusalCode(error) !== 'stale_statement') throw error;
    return { rights: await readUploadRights(request), changed: true };
  }
}

/** The statement a refused upload plan carries (409 `rights_needed`), to show, or null. */
export function rightsAsked(problem: unknown): UploadRights | null {
  if (!(problem instanceof CloudError) || problem.code !== 'rights_needed') return null;
  const payload = (problem.payload ?? {}) as { detail?: unknown };
  const detail = (payload.detail ?? payload) as { statement?: unknown; version?: unknown; wording_sha256?: unknown };
  if (typeof detail.statement !== 'string' || typeof detail.version !== 'string' || typeof detail.wording_sha256 !== 'string') return null;
  return { applies: true, reason: null, accepted: false, version: detail.version, statement: detail.statement, wording_sha256: detail.wording_sha256, accepted_at: null };
}

/** Whether uploads may start: the current wording is confirmed, or the statement does not apply
 * (a business workspace). Any failure to ask is a no. */
export async function hasUploadConsent(request: Request): Promise<boolean> {
  try {
    const rights = await readUploadRights(request);
    return rights.accepted || !rights.applies;
  } catch {
    return false;
  }
}

/** The check the upload queue is given: `check(workspaceId)` asks for that workspace. */
export function uploadConsentCheck(requestFor: (workspaceId: string) => Request): (workspaceId: string) => Promise<boolean> {
  return (workspaceId) => hasUploadConsent(requestFor(workspaceId));
}

/** One song on this device that could upload. `size` is null when the browser can't say without
 * asking for permission again; the queue asks when the song's turn comes. */
export type UploadCandidate = {
  songId: number;
  sha: string;
  title: string;
  /** The file's own name, never a path. */
  fileName: string;
  size: number | null;
  duration: number | null;
};

/** The file's name and size as this device knows them, without asking for permission. */
async function fileFacts(song: StoredSong): Promise<{ name: string; size: number | null }> {
  if (song.ref.kind === 'repick') return { name: song.ref.name, size: song.ref.size };
  const known = song.sources?.find((source) => source.size > 0)?.size ?? null;
  if (known !== null) return { name: song.ref.handle.name, size: known };
  try {
    const allowed = song.ref.handle.queryPermission ? await song.ref.handle.queryPermission({ mode: 'read' }) : 'granted';
    if (allowed !== 'granted') return { name: song.ref.handle.name, size: null };
    return { name: song.ref.handle.name, size: (await song.ref.handle.getFile()).size || null };
  } catch {
    return { name: song.ref.handle.name, size: null };
  }
}

/** The songs on this device as upload candidates: every song, or only `songIds`. */
export async function candidatesFrom(store: MediaStore, songIds?: readonly number[]): Promise<UploadCandidate[]> {
  const wanted = songIds ? new Set(songIds) : null;
  const rows = (await store.all()).filter((row) => !wanted || wanted.has(row.songId));
  const out: UploadCandidate[] = [];
  for (const row of rows) {
    const facts = await fileFacts(row);
    out.push({
      songId: row.songId,
      sha: row.identity.content_sha256,
      title: row.identity.title || facts.name,
      fileName: facts.name,
      size: facts.size,
      duration: typeof row.identity.duration_s === 'number' && row.identity.duration_s > 0 ? row.identity.duration_s : null,
    });
  }
  return out;
}

/** What the dry run said of one file (`storage.upload_preview`). */
export type PreviewStatus = 'ok' | 'in_cloud_library' | 'refused';
export type PreviewReason = 'song_mismatch' | 'format' | 'too_large' | 'too_long' | 'quota';
type PreviewFile = { index: number; name: string; song_id: number | null; status: PreviewStatus; reason: PreviewReason | null; notes: string[] };
type PreviewAnswer = {
  files: PreviewFile[];
  totals: { bytes_left: number; measure_days: number | null };
};

/** The whole batch, over as many dry runs as it takes. */
export type UploadPreview = {
  /** Songs that would upload now, in order, and their bytes. */
  upload: UploadCandidate[];
  uploadBytes: number;
  /** Songs that would wait for room: the first that doesn't fit stops the rest, as the queue does. */
  waiting: UploadCandidate[];
  inCloud: UploadCandidate[];
  refused: { song: UploadCandidate; reason: Exclude<PreviewReason, 'quota'> }[];
  /** Songs whose size this browser can't read now; they are checked when their turn comes. */
  unchecked: UploadCandidate[];
  /** Songs over the length the cloud's mixes take; they still upload and play. */
  long: UploadCandidate[];
  bytesLeft: number;
  /** Days measuring takes under the plan's daily cap, or null when no cap applies. */
  measureDays: number | null;
  /** True when the batch needed more than one dry run, so `measureDays` is the least it takes. */
  measureAtLeast: boolean;
};

/** Ask what uploading `songs` would do. Reads only: nothing is reserved or sent. */
export async function previewUploads(request: Request, songs: readonly UploadCandidate[]): Promise<UploadPreview> {
  const sized = songs.filter((song) => song.size !== null && song.size > 0);
  const result: UploadPreview = {
    upload: [], uploadBytes: 0, waiting: [], inCloud: [], refused: [],
    unchecked: songs.filter((song) => song.size === null || song.size <= 0), long: [],
    bytesLeft: 0, measureDays: null, measureAtLeast: false,
  };
  const wouldSend: UploadCandidate[] = [];
  let days: number | null = null;
  let runs = 0;
  for (let start = 0; start < sized.length; start += PREVIEW_BATCH) {
    const chunk = sized.slice(start, start + PREVIEW_BATCH);
    runs += 1;
    const answer = await request<PreviewAnswer>(PREVIEW_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: chunk.map((song) => ({ name: song.fileName, size: song.size, sha256: song.sha, song_id: song.songId, ...(song.duration ? { duration: song.duration } : {}) })),
      }),
    });
    result.bytesLeft = answer.totals.bytes_left;
    if (answer.totals.measure_days !== null) days = Math.max(days ?? 0, answer.totals.measure_days);
    for (const file of answer.files) {
      const song = chunk[file.index];
      if (!song) continue;
      if (file.status === 'in_cloud_library') result.inCloud.push(song);
      else if (file.status === 'refused' && file.reason && file.reason !== 'quota') result.refused.push({ song, reason: file.reason });
      else {
        wouldSend.push(song);
        if (file.notes.includes('long_for_server_mixes')) result.long.push(song);
      }
    }
  }
  // the room left is counted over the whole batch, in order, as the queue counts it
  let room = result.bytesLeft;
  for (const song of wouldSend) {
    if (result.waiting.length === 0 && (song.size ?? 0) <= room) {
      result.upload.push(song);
      result.uploadBytes += song.size ?? 0;
      room -= song.size ?? 0;
    } else {
      result.waiting.push(song);
    }
  }
  result.measureDays = result.upload.length ? days : null;
  result.measureAtLeast = runs > 1;
  return result;
}

/** The plain refusal words for one reason. */
export const REFUSAL_WORDS: Record<Exclude<PreviewReason, 'quota'>, string> = {
  too_large: 'Bigger than your plan takes for one song',
  too_long: 'Longer than your plan takes for one song',
  format: 'A kind of file uploads don’t take, such as WMA',
  song_mismatch: 'This file is no longer the song in your library',
};

/** The member's choice for songs once they are uploaded. */
export type UploadChoice = { keepHere: boolean };

/** Start uploading `songs` (the upload queue's start). */
export type StartUploads = (songs: UploadCandidate[], choice: UploadChoice) => void | Promise<void>;

let boundStart: StartUploads | null = null;
const listeners = new Set<() => void>();

/** The upload queue registers its start here once it can run, and null when it stops; the entry
 * points show only while one is bound, so nothing offers an upload this device can't run. */
export function bindUploadStart(start: StartUploads | null): void {
  boundStart = start;
  for (const listener of listeners) listener();
}

export function uploadStart(): StartUploads | null {
  return boundStart;
}

export function onUploadStart(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A refusal's code, for the sheet to say plainly what went wrong. */
export function refusalCode(error: unknown): string | null {
  return error instanceof CloudError ? error.code ?? null : null;
}
