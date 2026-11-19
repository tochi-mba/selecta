import { flagOn, type FlagId } from '../flags';

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
