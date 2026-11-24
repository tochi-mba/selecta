import type { MediaResolver, MediaStore } from '../media';
import { derivedStore, type DerivedStore } from '../media/derived';
import { WAVEFORM_VERSION } from '../media/fingerprints';
import { bytesSha256 } from '../media/identity';

/** Listen's waveform strip, reused by fingerprint (ADR-0469 amendment, `cloud.content_cache`).
 *
 * A waveform is a pure function of the bytes, so it is kept in this browser's device-wide
 * derived store under the song's content hash: drawn once, by whichever account here played the
 * file first. It is read only for a hash this workspace's own index has proven from the bytes,
 * and written only after the bytes in hand hashed to that hash. Off, it is drawn each visit, as
 * before. */
export async function waveformFor(songId: number, deps: {
  resolve: MediaResolver;
  openStore: () => Promise<MediaStore>;
  shared: boolean;
  decode: (bytes: ArrayBuffer) => Promise<number[]>;
  open?: () => Promise<DerivedStore>;
}): Promise<number[] | null> {
  const media = deps.shared ? await deps.openStore() : null;
  const song = media ? await media.get(songId) : null;
  const sha = song?.identity.content_sha256 ?? '';
  const derived = song ? await (deps.open ?? derivedStore)() : null;
  if (derived && song && !song.fingerprint && song.availabilityIssue !== 'changed') {
    const kept = await derived.get<number[]>('waveform', WAVEFORM_VERSION, sha);
    if (kept) return kept;
  }
  const track = await deps.resolve(songId);
  if (!track) return null;
  const bytes = await track.data();
  // hashed before decoding: decoding may hand the buffer over and leave it empty
  const proven = derived ? (await bytesSha256(bytes)) === sha : false;
  const peaks = await deps.decode(bytes);
  if (derived && media && proven) {
    if (song?.fingerprint) await media.confirmFingerprint(songId);
    await derived.put('waveform', WAVEFORM_VERSION, sha, peaks);
  }
  return peaks;
}
