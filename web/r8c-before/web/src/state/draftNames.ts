import { DraftList, get } from '../api';
import { flagOn } from '../flags';

/** Each draft's id and name, and the current mix's name: all a picker or shortcut needs. */
export type DraftNames = { drafts: { id: number; name: string }[]; current: { name: string } };

const fromFull = (list: DraftList): DraftNames => ({
  drafts: (list.drafts ?? []).map(({ id, name }) => ({ id, name })),
  current: { name: list.current?.name ?? '' },
});

/** mymixes.lean_list: names alone come from /drafts/names, which reads no songs, transitions or
 * revisions, so a picker doesn't pay for the whole My Mixes list. With the flag off, or from a
 * server that doesn't have it yet, the full list is asked for and cut down to the same shape. */
export async function getDraftNames(): Promise<DraftNames> {
  if (flagOn('mymixes.lean_list')) {
    try {
      const lean = await get<DraftNames>('/drafts/names');
      if (Array.isArray(lean?.drafts)) return { drafts: lean.drafts, current: { name: lean.current?.name ?? '' } };
    } catch { /* an older server: the full list below says the same */ }
  }
  return fromFull(await get<DraftList>('/drafts'));
}
