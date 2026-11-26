import type { SeamMove } from '../dsp/seamScript';

/** Each move the account's planner can name (src/selecta/planner_core/recipes/__init__.py
 * `all_recipes`), and the move this browser's live engine plays for it (dsp/seamScript.ts), or
 * null where the live engine can't play it honestly. A null move is passed over for the planner's
 * next-ranked choice (cloud/accountSeams.ts). The one table; docs/engineering/device-to-account.md
 * repeats it. Word moves (`styles.wordplay`) and stem moves are never in the planner's list for a
 * pair, and a name not here is passed over too. */
export const PLANNER_MOVES: Readonly<Record<string, { live: SeamMove; beatmatched: boolean } | null>> = {
  // blend.py: the overlap ends on the exit bar, equal-power gains over 65 percent of it, one low
  // end traded on a bar line; the live move is the same, B stretched to A's tempo for the overlap
  bass_swap_blend: { live: 'bass_swap_blend', beatmatched: true },
  // blend.py: the same bass trade, A's highpass 30 Hz to 2 kHz, B's lowpass 300 Hz to 20 kHz
  filter_sweep: { live: 'filter_sweep', beatmatched: true },
  // exits.py: a declicked cut at the exit cue, B from its entry cue; the live cut is the same
  cut_on_one: { live: 'cut_on_one', beatmatched: false },
  // exits.py: A's last beat into an in-time echo as B lands; the live return is the same recipe
  echo_out: { live: 'echo_out', beatmatched: false },
  // exits.py: A's last two beats into a room as A fades over a beat; the live wash is the same
  reverb_wash: { live: 'reverb_wash', beatmatched: false },
  // blend.py rides both songs to a shared tempo; the live engine never changes the playing song's speed
  tempo_ramp: null,
  // exits.py throws A's last sung word into a delay; the browser knows no word timing
  delay_throw: null,
  // loop.py repeats A's last clean bars under B (move.loop_room); the live engine cannot loop a
  // playing song, so only the rendered path (dsp/render/) plays it, from the planner's script
  loop_room: null,
  // bridge.py walks A's tempo to B's over sixteen bars (move.tempo_bridge); the live engine never
  // changes the playing song's speed, so only the rendered path plays it, from the script
  tempo_bridge: null,
};

/** The live move for a planner move, or null when it has none. */
export function liveMoveFor(move: string): { live: SeamMove; beatmatched: boolean } | null {
  return Object.prototype.hasOwnProperty.call(PLANNER_MOVES, move) ? PLANNER_MOVES[move] : null;
}
