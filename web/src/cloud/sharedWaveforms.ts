import type { MediaResolver, MediaStore } from '../media';
import { derivedStore, type DerivedStore } from '../media/derived';
import { WAVEFORM_VERSION } from '../media/fingerprints';
import { bytesSha256 } from '../media/identity';
import { breathe } from '../media/breathe';
import { peaksInSlices, type PcmChannels } from '../dsp/waveform';

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

export type WaveformDeps = Parameters<typeof waveformFor>[1];

/** Every waveform Listen has this visit, by song: the strip's and the live blend's (ADR-0477 plan
 * 3.4). A song the engine decoded to play gives its peaks from that very audio, so the next song's
 * waveform is ready before its hand-over starts and its file is never decoded a second time just
 * for the picture. Peaks made that way stay in this visit's memory only: the device-wide store
 * keeps what was hashed from the bytes here (waveformFor), and the engine's audio carries no
 * such proof of its own. */
export type WaveformBook = {
  /** A song's peaks: kept, or else read from its own file (waveformFor). Null when none can be had. */
  of(songId: number, deps: WaveformDeps): Promise<number[] | null>;
  /** The engine decoded this song to play it: make its peaks from that audio, unless kept already. */
  fromDecoded(songId: number, audio: PcmChannels): void;
};

export function waveformBook(rest: () => Promise<void> = breathe): WaveformBook {
  const kept = new Map<number, Promise<number[] | null>>();
  const keep = (songId: number, made: Promise<number[] | null>) => {
    kept.set(songId, made);
    // a song that could not be read this time (not connected yet, say) is tried again next time
    void made.then((peaks) => { if (!peaks && kept.get(songId) === made) kept.delete(songId); });
    return made;
  };
  return {
    of: (songId, deps) => kept.get(songId) ?? keep(songId, waveformFor(songId, deps).catch(() => null)),
    fromDecoded(songId, audio) {
      if (kept.has(songId) || !(audio.length > 0)) return;
      keep(songId, peaksInSlices(audio, rest).catch(() => null));
    },
  };
}
