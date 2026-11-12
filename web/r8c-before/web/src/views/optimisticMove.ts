import { MixData, MixItem } from '../api';
import { orderOf } from '../state/readiness';

/** MI-0162-05: what the server's move will give back, shown straight away in a draft. It mirrors
 * `move_song` in src/selecta/mix.py: the moved song, the song that closes the gap it left and the song
 * after its new place all lead in from a new neighbour, so their seams are new and not rendered yet. */
export function movedLocally(mix: MixItem[], from: number, to: number): MixItem[] {
  if (from === to || from < 0 || to < 0 || from >= mix.length || to >= mix.length) return mix;
  const items = [...mix];
  const [moving] = items.splice(from, 1);
  items.splice(to, 0, moving);
  // the song that closes the gap sits at `from` after a move down, at `from + 1` after a move up
  const fresh = new Set([to, from < to ? from : from + 1, to + 1]);
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

/** What became of one queued draft move. `last` says no other move is still waiting behind it. */
export type QueuedMove =
  | { kind: 'saved'; answer: MixData; last: boolean }
  | { kind: 'refused'; error: unknown; restore: MixData; last: boolean }
  | { kind: 'dropped'; last: boolean };

type Outcome =
  | { kind: 'saved'; answer: MixData }
  | { kind: 'refused'; error: unknown; restore: MixData }
  | { kind: 'dropped' };

let waitingEverywhere = 0;

/** Whether any draft move is still on its way. A draft read that answers meanwhile describes an order
 * from before the moves on screen, so the app leaves it unshown; the last move's answer is newer. */
export const draftMovesWaiting = () => waitingEverywhere > 0;

/** MI-0162-05: a draft's moves go to the server one after another, each guarded by the order the server
 * itself confirmed last, so a key pressed while earlier moves are on their way is shown at once and
 * queued rather than refused. The server still checks every move against its own revision: a refusal
 * hands back the last order it confirmed (to put on screen), and the moves already shown on top of the
 * refused one are dropped unsent, because the order they were made against never existed. */
export class MoveQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private added = 0;
  private dropUpTo = 0;
  private confirmed: MixData | null = null;

  get busy() {
    return this.waiting > 0;
  }

  /** `shown` is the draft on screen now, before this move; `send` posts the move with an order guard. */
  add(shown: MixData, send: (order: string) => Promise<MixData>): Promise<QueuedMove> {
    // with nothing on its way, what is shown is exactly what the server has
    if (this.waiting === 0) this.confirmed = shown;
    this.waiting += 1;
    waitingEverywhere += 1;
    const index = ++this.added;
    const turn = this.chain.then(async (): Promise<Outcome> => {
      if (index <= this.dropUpTo) return { kind: 'dropped' };
      const known = this.confirmed ?? shown;
      try {
        const answer = await send(orderOf(known.mix));
        this.confirmed = answer;
        return { kind: 'saved', answer };
      } catch (error) {
        this.dropUpTo = this.added;
        return { kind: 'refused', error, restore: known };
      }
    }).then((result) => {
      this.waiting -= 1;
      waitingEverywhere -= 1;
      return { ...result, last: this.waiting === 0 };
    });
    this.chain = turn;
    return turn;
  }
}
