import type { SongFacts } from '../dsp/analysis/song';
import type { StoredSong } from '../media';

/** Test doubles for the device-to-account tests: a song measured on this device, and a song
 * index entry that carries every private thing a real one does (a title, a file name, a folder
 * path), so a test can prove none of it is ever sent. */

/** A steady 4/4 song: `bars` bars at `bpm` from `offset` seconds, every bar array filled. */
export function measuredSong({ bpm = 120, bars = 64, offset = 0.25 }: { bpm?: number; bars?: number; offset?: number } = {}): SongFacts {
  const period = 60 / bpm;
  const beats = Float64Array.from({ length: bars * 4 }, (_, index) => offset + index * period);
  const duration = offset + bars * 4 * period + 2;
  return {
    implementation: 'web-dsp-1',
    analysis_version: 3,
    beat_source: 'web-onset-comb-beats-1',
    beat_confidence: 0.8,
    sample_rate: 44100,
    duration_s: duration,
    row: {
      bpm, constant_tempo: 1, grid_confidence: 0.9, beats_per_bar: 4, key: 'A minor', camelot: '8A',
      key_confidence: 0.2, key_agrees_chroma: 1, lufs: -9.1, peak_db: -0.3, energy: 0.62,
      sections: [{ start_bar: 0, end_bar: bars, label: 'verse', energy: 0.6, group: 0, chorus_prob: 0 }],
      timbre: Array.from({ length: 29 }, (_, index) => index / 10),
    },
    arrays: {
      beats,
      bar_starts: Int32Array.from({ length: bars }, (_, index) => index * 4),
      energy_bars: Float32Array.from({ length: bars }, () => 0.5),
      low_share_bars: Float32Array.from({ length: bars }, () => 0.3),
      rms_db_bars: Float32Array.from({ length: bars }, () => -12),
      chroma_bars: Float32Array.from({ length: bars * 12 }, (_, index) => (index % 12) / 11),
      mfcc_bars: Float32Array.from({ length: bars * 20 }, (_, index) => (index % 20) - 10),
      raw_beats: Float32Array.from(beats),
      raw_downbeats: Float32Array.from({ length: bars }, (_, index) => beats[index * 4]),
      peaks: new Uint8Array(1600).fill(200),
    },
  };
}

/** The private words a song index entry holds, which no request may carry. */
export const PRIVATE_WORDS = ['Secret Title', 'Hidden Artist', 'secret-file.mp3', 'My Music', 'Private Folder'];

/** One song in this device's index, with a file handle and a watched folder's path. */
export function heldSong(songId: number, sha: string, extra: Partial<StoredSong> = {}): StoredSong {
  return {
    songId,
    identity: { content_sha256: sha, title: 'Secret Title', artist: 'Hidden Artist', album: 'Private Folder', duration_s: 140 },
    ref: { kind: 'handle', handle: { kind: 'file', name: 'secret-file.mp3', getFile: async () => new File([], 'secret-file.mp3') } },
    importedAt: 1,
    sources: [{ folderId: 'folder-1', path: 'My Music/Private Folder/secret-file.mp3', size: 1234, modified: 5 }],
    ...extra,
  } as unknown as StoredSong;
}

export const shaOf = (n: number) => n.toString(16).padStart(64, '0');
