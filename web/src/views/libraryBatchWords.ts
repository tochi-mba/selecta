/** The words of the Library's batch dialog and its toast, in plain language (they used to read
 * like a developer tool: "precisely 18 recordings", "(ID 3091; priority off; excluded no)"). */

export type BatchAction = 'never' | 'allow' | 'prioritize' | 'deprioritize';

const songs = (count: number) => `${count} ${count === 1 ? 'song' : 'songs'}`;

export function batchWords(action: BatchAction, count: number) {
  const one = count === 1;
  const these = one ? 'this song' : 'these songs';
  const them = one ? 'it' : 'them';
  const n = songs(count);
  switch (action) {
    case 'never':
      return {
        title: `Never play ${n}?`,
        body: `SelectaDJ won’t pick ${these} when it builds a mix. You can still add ${them} by hand, and change this any time.`,
        confirm: `Never play ${n}`,
        done: `${n} won’t be picked for mixes.`,
      };
    case 'allow':
      return {
        title: `Allow ${n} in mixes?`,
        body: `SelectaDJ can pick ${these} again when it builds a mix. You can change this any time.`,
        confirm: `Allow ${n}`,
        done: `${n} can be picked for mixes again.`,
      };
    case 'prioritize':
      return {
        title: `Prioritize ${n}?`,
        body: `SelectaDJ gets ${these} ready before the rest of your Library, so ${one ? 'it is' : 'they are'} in mixes sooner. You can change this any time.`,
        confirm: `Prioritize ${n}`,
        done: `${n} ${one ? 'is' : 'are'} now prioritized.`,
      };
    default:
      return {
        title: `Remove priority from ${n}?`,
        body: `${one ? 'This song is' : 'These songs are'} got ready in ${one ? 'its' : 'their'} usual turn. You can change this any time.`,
        confirm: `Remove priority from ${n}`,
        done: `${n} no longer ${one ? 'has' : 'have'} priority.`,
      };
  }
}

/** Each listed song as "Title, Artist". The song's ID is added only where two listed songs share a
 * title and artist, so same-name songs can still be told apart. */
export function batchLines(list: readonly { id: number; title: string; artist: string }[]): { id: number; line: string }[] {
  const key = (song: { title: string; artist: string }) => `${song.title}\u0000${song.artist}`;
  const seen = new Map<string, number>();
  for (const song of list) seen.set(key(song), (seen.get(key(song)) ?? 0) + 1);
  return list.map((song) => ({
    id: song.id,
    line: `${song.title}, ${song.artist}${(seen.get(key(song)) ?? 0) > 1 ? ` (ID ${song.id})` : ''}`,
  }));
}
