/** Which studio makes each transition of the current mix (cloud.studio_seams, two-places plan
 * Phase 5; docs/engineering/device-studio-playback.md, "Transitions made in the cloud").
 *
 * - `cloud`: both songs have their OWN copy in the cloud library (a version's copy does not
 *   count: the seams route finds each song by its own hashes). A song held in both places uses the
 *   cloud studio too (ADR-0479), and a song next to a cloud seam plays from its lossless file, so
 *   the clip and the song come from the same decode.
 * - `device`: both songs are on this device and the device studio is on.
 * - `live`: anything else; the transition is worked out as the mix plays.
 *
 * On Data Saver or mobile data no seam is `cloud` and no lossless file is read, so every song
 * plays from its original. The device studio fetches no audio, so it is not changed by that.
 * A transition whose cue points the member chose stays theirs. Pure, so every case is tested.
 */

export type SeamStudio = 'cloud' | 'device' | 'live';

/** One song of the mix, in play order. */
export type PlanSong = {
  songId: number;
  /** It has its own copy in the cloud library. */
  cloud: boolean;
  /** Its file is on this device. */
  here: boolean;
  /** The member chose where the transition into this song leaves and enters. */
  cued?: boolean;
};

export type ConnectionLike = { saveData?: boolean; type?: string } | null | undefined;

export type StudioPlan = {
  /** `seams[i]`: the transition from song i into song i + 1. */
  seams: SeamStudio[];
  /** `lossless[i]`: song i plays from its lossless file, next to a cloud seam. */
  lossless: boolean[];
  /** Data Saver or mobile data: nothing from the cloud studio. */
  metered: boolean;
};

/** Data Saver on, or a mobile data connection. */
export function meteredConnection(connection: ConnectionLike): boolean {
  return connection?.saveData === true || connection?.type === 'cellular';
}

/** The browser's own connection, when it says one. */
export function browserConnection(): ConnectionLike {
  return typeof navigator === 'undefined' ? null : (navigator as Navigator & { connection?: ConnectionLike }).connection ?? null;
}

export function planStudios(songs: readonly PlanSong[], options: { cloud: boolean; device: boolean; connection?: ConnectionLike }): StudioPlan {
  const metered = meteredConnection(options.connection);
  const seams = songs.slice(1).map((to, at): SeamStudio => {
    const from = songs[at];
    // the same song twice in a row is no pair: it plays live
    if (from.songId === to.songId || to.cued) return 'live';
    if (options.cloud && !metered && from.cloud && to.cloud) return 'cloud';
    if (options.device && from.here && to.here) return 'device';
    return 'live';
  });
  const lossless = songs.map((_, index) => seams[index - 1] === 'cloud' || seams[index] === 'cloud');
  return { seams, lossless, metered };
}
