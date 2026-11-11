import { MixData, MixItem } from '../api';

/** MI-0162-05: what the server's move will give back, shown straight away in a draft. It mirrors
 * `move_song` in src/selecta/mix.py: the moved song, the song that closes the gap it left and the song
 * after its new place all lead in from a new neighbour, so their seams are new and not rendered yet. */
export function movedLocally(mix: MixItem[], from: number, to: number): MixItem[] {
  if (from === to || from < 0 || to < 0 || from >= mix.length || to >= mix.length) return mix;
  const items = [...mix];
  const [moving] = items.splice(from, 1);
  items.splice(to, 0, moving);
  const fresh = new Set([to, from, to + 1]);
  return items.map((item, position) => {
    const renumbered = item.position === position ? item : { ...item, position };
    if (!fresh.has(position) || position >= items.length) return renumbered;
    return {
      ...renumbered,
      seam: position === 0 ? null : {
        settings: {},
        state: { status: 'none', key: `pending:${items[position - 1].song_id}>${item.song_id}` },
      },
    };
  });
}

/** The draft as the editor shows it, rebuilt from its props, so a refused move can be put back. */
export function draftShown(
  mix: MixItem[], name: string, canUndo: boolean, draftId: number, place: number | null | undefined,
  eta: MixData['eta'],
): MixData {
  return { mix, name, can_undo: canUndo, eta, draft: { id: draftId, place: place ?? null } };
}
