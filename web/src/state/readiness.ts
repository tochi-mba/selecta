import type { DraftInfo, LibrarySong, MixItem, SeamState } from '../api';
import { draftWords } from '../lib';
import type { StatusKind } from '../ui/controls';

/** One answer to "what state is this in, and what can be done with it?", worked out from what the
 * server says and used by every page. A page never decides for itself from a single field, so a badge
 * and the buttons beside it can't disagree. Anything the server says that isn't recognised is shown
 * as unknown. It never gets promoted to ready. */

export type TrackReadiness = {
  kind: StatusKind;
  words: string;
  reason: string;
  /** It can start a mix, and be picked by one. */
  canStartMix: boolean;
  /** It has been analysed, so a person can put it in a mix by hand. */
  canAdd: boolean;
  canAnalyse: boolean;
  /** Is it music at all, as far as Selecta is concerned? */
  setAside: boolean;
};

const TRACK: Record<string, { kind: StatusKind; words: string }> = {
  mix_ready: { kind: 'ready', words: 'Ready for mixes' },
  analysed_incomplete: { kind: 'warning', words: 'Not ready for mixes' },
  queued: { kind: 'queued', words: 'Waiting to be analysed' },
  processing: { kind: 'working', words: 'Being analysed' },
  needs_attention: { kind: 'failed', words: 'Couldn’t be analysed' },
  set_aside: { kind: 'unavailable', words: 'Set aside' },
  excluded: { kind: 'unavailable', words: 'Never plays' },
  missing: { kind: 'failed', words: 'File is missing' },
};

export function trackReadiness(song: Pick<LibrarySong, 'bpm' | 'readiness'> & Partial<LibrarySong>): TrackReadiness {
  const status = song.readiness?.status ?? 'unknown';
  const facts = TRACK[status] ?? { kind: 'unavailable' as StatusKind, words: 'State unknown' };
  const analysed = song.bpm !== null && song.bpm !== undefined;
  return {
    ...facts,
    reason: song.readiness?.reason ?? '',
    canStartMix: status === 'mix_ready',
    // a tempo alone never makes a song mix-ready, but it's what adding one by hand has always needed
    canAdd: analysed && !['set_aside', 'excluded', 'missing', 'needs_attention'].includes(status),
    canAnalyse: !analysed && !['set_aside', 'excluded', 'missing'].includes(status),
    setAside: status === 'set_aside',
  };
}

export type MixReadiness = {
  seams: number;
  ready: number;
  failed: number;
  waiting: number;
  rendering: number;
  /** A transition whose incoming edge would be cut off cannot safely be called ready. */
  blocked: number;
  /** Every transition exists as audio, so it plays exactly as planned from start to finish. */
  allReady: boolean;
  firstProblem: number | null;
};

const seamStatus = (item: MixItem): SeamState['status'] | 'unknown' => {
  const status = item.seam?.state?.status;
  return status && ['none', 'queued', 'rendering', 'ready', 'failed'].includes(status) ? status : 'unknown';
};

export function mixReadiness(mix: MixItem[]): MixReadiness {
  const seams = mix.slice(1);
  // The server can report a cached, playable seam while also telling us that its
  // placement would cut off the previous transition. Do not count that edge as
  // ready, or invite the user to render an invalid placement.
  const count = (...kinds: string[]) => seams.filter((item) => !item.seam?.too_soon && kinds.includes(seamStatus(item))).length;
  const blocked = seams.filter((item) => !!item.seam?.too_soon).length;
  const failed = count('failed');
  const firstBad = mix.findIndex((item, index) => index > 0 && (seamStatus(item) === 'failed' || !!item.seam?.too_soon));
  return {
    seams: seams.length,
    ready: count('ready'),
    failed,
    waiting: count('none', 'unknown'),
    rendering: count('queued', 'rendering'),
    blocked,
    allReady: seams.length > 0 && count('ready') === seams.length,
    firstProblem: firstBad > 0 ? firstBad : null,
  };
}

/** A saved draft and a draft you can hear in full are different things, so they read differently. */
export function draftReadiness(draft: DraftInfo): { kind: StatusKind; words: string } {
  const words = draftWords(draft);
  if (draft.songs === 0 || draft.seams === 0) return { kind: 'planned', words };
  // A failed edge needs attention even while other seams remain in the line.
  // It must not be hidden behind a reassuring "working" or "in line" badge.
  if (draft.failed > 0) return { kind: 'warning', words };
  if (draft.rendering) return { kind: 'working', words };
  if (draft.waiting > 0) return { kind: draft.place !== null ? 'queued' : 'planned', words };
  // A partially upgraded server can omit counts. Never upgrade an inconsistent
  // reply to "ready to play" just because the wait and failure counts are zero.
  if (draft.ready !== draft.seams) return { kind: 'unavailable', words };
  return { kind: 'ready', words };
}

/** The song and which time it appears, because the same song can be in a mix twice. Row identity and
 * focus follow this, not the position, so they survive the mix moving around. */
export function occurrenceKeys(mix: Pick<MixItem, 'song_id'>[]): string[] {
  const seen = new Map<number, number>();
  return mix.map((item) => {
    const times = seen.get(item.song_id) ?? 0;
    seen.set(item.song_id, times + 1);
    return `${item.song_id}#${times}`;
  });
}

export const orderOf = (mix: Pick<MixItem, 'song_id'>[]): string => mix.map((item) => item.song_id).join(',');
