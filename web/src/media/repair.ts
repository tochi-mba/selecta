import type { TrackIdentity } from './identity';
import type { StoredSong } from './store';

// Missing-media repair (ADR-0458, BF-0458-05).
//
// A recipe is metadata-only and follows the member between devices; the files may not. Opening
// a recipe where 5 of 8 tracks are missing is a repair flow, not an error page: this module is
// the pure model behind it, matching a recipe's identities against the local index and
// re-matching re-imported files by content hash. Rendering belongs elsewhere.

export type RepairMatch = { identity: TrackIdentity; songId: number };

export type MissingReason = 'not_imported' | 'needs_regrant';

export type RepairMissing = { identity: TrackIdentity; reason: MissingReason };

export type RepairPlan = { matched: RepairMatch[]; missing: RepairMissing[] };

/** Match a recipe's track identities against this device's index. Tracks whose handle lapsed
 * (pass their songIds in `lapsed`) count as missing with `needs_regrant`, so the repair view
 * can offer the re-authorisation flow instead of a re-import. Recipe order is kept within each
 * list. */
export function planRepair(recipe: TrackIdentity[], local: StoredSong[], lapsed: ReadonlySet<number> = new Set()): RepairPlan {
  const byHash = new Map(local.map((song) => [song.identity.content_sha256, song]));
  const matched: RepairMatch[] = [];
  const missing: RepairMissing[] = [];
  for (const identity of recipe) {
    const here = byHash.get(identity.content_sha256);
    if (!here) missing.push({ identity, reason: 'not_imported' });
    else if (lapsed.has(here.songId)) missing.push({ identity, reason: 'needs_regrant' });
    else matched.push({ identity, songId: here.songId });
  }
  return { matched, missing };
}

/** Fold a re-import's registrations back into a plan: anything whose content hash now resolves
 * moves from missing to matched, and the rest stays honestly missing. The recipe's revisions
 * are untouched; repair only changes what this device can reach. */
export function acceptReimport(plan: RepairPlan, imported: { content_sha256: string; song_id: number }[]): RepairPlan {
  const byHash = new Map(imported.map((song) => [song.content_sha256, song.song_id]));
  const matched = [...plan.matched];
  const missing: RepairMissing[] = [];
  for (const item of plan.missing) {
    const songId = byHash.get(item.identity.content_sha256);
    if (songId === undefined) missing.push(item);
    else matched.push({ identity: item.identity, songId });
  }
  return { matched, missing };
}

/** True when the recipe can open at all on this device: read-only for the parts that resolve
 * is fine, a recipe with nothing resolvable opens straight into repair. */
export function anyPlayable(plan: RepairPlan): boolean {
  return plan.matched.length > 0;
}
