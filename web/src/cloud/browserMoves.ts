import { flagOn, type FlagId } from '../flags';
import { PICKER, STEM_MOVE_LABELS } from './stems/stemsCopy';
import type { StemMove, StemsAbility } from './stems/types';
import { stemsFlagOn } from './stems/flag';

/** The moves a browser mix can ask for (`cloud.browser_moves`, ADR-0459): local mode's moves the
 * browser engine can really play (dsp/seamScript.ts), named and described as local mode names
 * them (src/selecta/seam_kinds.py MOVES), plus 'auto'. The moves that need stems, lyric timing or
 * a time-stretch (vocal ride, word moves, delay throw, tempo ramp) are not offered here. */
export const BROWSER_MOVES = ['auto', 'bass_swap_blend', 'filter_sweep', 'cut_on_one', 'echo_out', 'reverb_wash'] as const;
export type BrowserMove = (typeof BROWSER_MOVES)[number];

export const BROWSER_MOVE_WORDS: Record<BrowserMove | 'blend', { label: string; about: string }> = {
  auto: { label: 'Let SelectaDJ pick', about: 'The best move these two songs allow, picked from the audio as the mix plays.' },
  blend: { label: 'Plain blend', about: 'Both songs play in time and cross over evenly.' },
  bass_swap_blend: { label: 'Blend', about: 'Both songs play in time, and they trade the bass halfway.' },
  filter_sweep: { label: 'Filter sweep', about: 'A filters away upward as B opens up.' },
  cut_on_one: { label: 'Cut', about: 'A clean cut onto B’s downbeat.' },
  echo_out: { label: 'Echo out', about: 'A’s last beat rings on as B lands under it.' },
  reverb_wash: { label: 'Reverb wash', about: 'A dissolves into a room as B arrives.' },
};

/** Each move's own flag, as local mode gates it (src/selecta/seam_kinds.py). */
const MOVE_FLAGS: Record<Exclude<BrowserMove, 'auto'>, FlagId> = {
  bass_swap_blend: 'move.bass_swap_blend',
  filter_sweep: 'move.filter_sweep',
  cut_on_one: 'move.cut',
  echo_out: 'move.echo_out',
  reverb_wash: 'move.reverb_wash',
};

/** Whether browser mixes pick and play moves at all; off keeps every seam a plain blend. */
export const browserMovesOn = (): boolean => flagOn('cloud.browser_moves');

/** The moves this account has on, in the order a member sees them; 'auto' first. */
export function browserMovesAllowed(on: (id: FlagId) => boolean = flagOn): BrowserMove[] {
  return BROWSER_MOVES.filter((move) => move === 'auto' || on(MOVE_FLAGS[move]));
}

/** What a seam asks for by default: SelectaDJ picks, or the old plain blend with the flag off. */
export const defaultBrowserMove = (): 'auto' | 'blend' => (browserMovesOn() ? 'auto' : 'blend');

/** The names of the moves this account has on, for `status.moves`: the editor offers these. */
export function browserMoveNames(on: (id: FlagId) => boolean = flagOn): Record<string, string> {
  return Object.fromEntries(browserMovesAllowed(on).map((move) => [move, BROWSER_MOVE_WORDS[move].label]));
}

/** The moves that need separated stems (`cloud.browser_stems`, ADR-0459 Tier 3), named and
 * described as local mode names them (src/selecta/seam_kinds.py MOVES). They are kept apart from
 * BROWSER_MOVES so that with stems off the list a member sees is exactly what it was. */
export const BROWSER_STEM_MOVES = ['vocal_ride', 'stem_arrange', 'stem_intertwine'] as const satisfies readonly StemMove[];

export const STEM_MOVE_WORDS: Record<StemMove, { label: string; about: string }> = {
  vocal_ride: { label: STEM_MOVE_LABELS.vocal_ride, about: 'B’s band comes in under A’s voice, before B starts singing.' },
  stem_arrange: { label: STEM_MOVE_LABELS.stem_arrange, about: 'A strips down to its melody, B is teased, then B’s bass and drums land.' },
  stem_intertwine: { label: STEM_MOVE_LABELS.stem_intertwine, about: 'Trade drums, bass and harmonic layers over sixteen bars, with vocals taking turns.' },
};

/** Each stem move's own flag, as local mode gates it (src/selecta/seam_kinds.py MOVE_FLAGS). */
const STEM_MOVE_FLAGS: Record<StemMove, FlagId> = {
  vocal_ride: 'move.vocal_ride',
  stem_arrange: 'move.strip_and_land',
  stem_intertwine: 'move.intertwined_stems',
};

/** The words for any browser move, stem moves included, or undefined for one this file does not
 * know. For "Scheduled here" lines and saved recipes once stems are wired. */
export function moveWords(move: string): { label: string; about: string } | undefined {
  return (BROWSER_MOVE_WORDS as Record<string, { label: string; about: string }>)[move]
    ?? (STEM_MOVE_WORDS as Record<string, { label: string; about: string }>)[move]
    ?? SCHEDULED_ONLY_WORDS[move];
}

/** Moves the browser can schedule but doesn't offer in the picker. In the browser only the next
 * song drifts (local mode's tempo ramp moves both), so it says that. */
const SCHEDULED_ONLY_WORDS: Record<string, { label: string; about: string }> = {
  tempo_ramp: { label: 'Tempo ramp', about: 'The next song starts at this song’s speed and eases back to its own.' },
};

/** The stem moves this account has on: the stems flag (registered and on), local's `stems`, and
 * each move's own flag. Empty with stems off. */
export function browserStemMovesAllowed(on: (id: FlagId) => boolean = flagOn): StemMove[] {
  if (!stemsFlagOn(on)) return [];
  return BROWSER_STEM_MOVES.filter((move) => on(STEM_MOVE_FLAGS[move]));
}

/** One entry in the editor's Move picker. `disabledReason` set: list it, but it can't be chosen,
 * and the reason is said beside it. `needsDownload`: it can be chosen, and choosing it offers the
 * splitter download (StemsOffer). */
export type OfferedMove = { move: string; label: string; disabledReason?: string; needsDownload?: boolean };

/** Every move the editor's Move picker lists, in order: the plain moves this account has on, then
 * the stem moves, marked unavailable with the device's reason or as needing the download. With
 * stems off (`ability` null or the flag off) this is exactly browserMoveNames, so the picker
 * reflows to what it was. Auto never picks a move listed with a `disabledReason`. */
export function browserMovesOffered(ability: StemsAbility, on: (id: FlagId) => boolean = flagOn): OfferedMove[] {
  const plain: OfferedMove[] = browserMovesAllowed(on).map((move) => ({ move, label: BROWSER_MOVE_WORDS[move].label }));
  if (!ability) return plain;
  const stems = browserStemMovesAllowed(on).map((move): OfferedMove => {
    const label = STEM_MOVE_WORDS[move].label;
    if (ability.state === 'unavailable') return { move, label, disabledReason: PICKER.unavailable(ability.reason) };
    if (ability.state === 'download_needed') return { move, label, needsDownload: true };
    return { move, label };
  });
  return [...plain, ...stems];
}

/** The stem moves Auto may pick on this device: only when the splitter is ready. */
export function stemMovesAutoMayPick(ability: StemsAbility, on: (id: FlagId) => boolean = flagOn): StemMove[] {
  return ability?.state === 'ready' ? browserStemMovesAllowed(on) : [];
}
