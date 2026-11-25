// Which songs the room is offered when it votes for the next one (ADR-0488).
//
// The speaker's browser chooses, because it is the planner: it knows which songs this device
// can play and which are already in the mix. A song scores higher when this browser has
// measured it as a harmonic match for the song that is playing, when rooms loved that very
// blend before, and when rooms loved the song. A little chance on top keeps the same three
// from being offered every time. With nothing known about any song, it is chance alone.

export type CrowdMark = { song_id: number; next_song_id: number | null; rooms: number };
export type MeasuredPair = { song_a: number; song_b: number };

export const OFFERED = 3;
const MATCH = 3;
const LOVED_BLEND = 2;
const LOVED_SONG = 1;

export function pickCandidates({ pool, from, pairs = [], marks = [], avoid = [], random = Math.random, count = OFFERED }: {
  /** Songs this device can play that are not in the mix. */
  pool: readonly { song_id: number; artist?: string }[];
  /** The song that is playing, which the winner will follow. */
  from: number | null;
  pairs?: readonly MeasuredPair[];
  marks?: readonly CrowdMark[];
  /** Songs to leave out: played lately, or already asked for. */
  avoid?: Iterable<number>;
  random?: () => number;
  count?: number;
}): number[] {
  const skip = new Set(avoid);
  if (from !== null) skip.add(from);
  const matches = new Set<number>();
  for (const pair of pairs) {
    if (pair.song_a === from) matches.add(pair.song_b);
    if (pair.song_b === from) matches.add(pair.song_a);
  }
  const blend = new Map<number, number>();
  const loved = new Map<number, number>();
  for (const mark of marks) {
    if (mark.next_song_id === null) loved.set(mark.song_id, mark.rooms);
    else if (mark.song_id === from) blend.set(mark.next_song_id, mark.rooms);
  }
  const scored = pool
    .filter((song) => !skip.has(song.song_id))
    .map((song) => ({
      song,
      score: (matches.has(song.song_id) ? MATCH : 0)
        + Math.min(3, blend.get(song.song_id) ?? 0) * LOVED_BLEND
        + Math.min(3, loved.get(song.song_id) ?? 0) * LOVED_SONG
        + random(),
    }))
    .sort((a, b) => b.score - a.score);
  // different artists where there are enough songs to allow it
  const chosen: typeof scored = [];
  for (const one of scored) {
    if (chosen.length >= count) break;
    const artist = one.song.artist?.split(';')[0].trim().toLowerCase();
    if (artist && chosen.some((other) => other.song.artist?.split(';')[0].trim().toLowerCase() === artist)) continue;
    chosen.push(one);
  }
  for (const one of scored) {
    if (chosen.length >= count) break;
    if (!chosen.includes(one)) chosen.push(one);
  }
  return chosen.map((one) => one.song.song_id);
}
