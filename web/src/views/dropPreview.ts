/**
 * CI-0173-02: which transitions a drag would change, worked out before the drop. Seam `i` is the
 * transition from song `i - 1` into song `i`. Moving the song at `from` so it ends up at `to` (the
 * editor's move contract) breaks the two seams around it where it was and the one seam it lands
 * in, and nothing else, so only those are marked.
 */
export function affectedSeams(from: number, to: number, count: number): number[] {
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return [];
  const seams = new Set<number>();
  if (from >= 1) seams.add(from);
  if (from + 1 < count) seams.add(from + 1);
  const landing = to < from ? to : to + 1;
  if (landing >= 1 && landing < count) seams.add(landing);
  return [...seams].sort((a, b) => a - b);
}

/** The songs the carried one would sit between after the drop, for the words beside the preview. */
export function newNeighbours<T>(items: T[], from: number, to: number): { before?: T; after?: T } {
  if (from === to || !items[from] || !items[to]) return {};
  const rest = items.filter((_, index) => index !== from);
  return { before: rest[to - 1], after: rest[to] };
}
