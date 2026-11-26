import { PLANNED_TRANSITION_WHY } from '../copy';
import { factsVersion } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';
import { BEATS_PER_BAR, scriptSeam, type ScriptRequest, type SeamAbilities } from '../dsp/seamScript';
import { LEAVE_AFTER_SECONDS, type SeamSchedule, type TrackTiming } from '../dsp/seams';
import { accountMeasured, answerWithin, askWithin, planningOn, type Request } from './accountFacts';
import { liveMoveFor } from './plannerMoves';
import { songFacts } from './songFacts';
import { renderedPlan, renderWaitMs } from './renderedPlan';
import { deviceRenderOn, type DeviceStudio } from './deviceStudio';

/** Each transition from the account's planner, played by the live engine (docs/engineering/
 * device-to-account.md).
 *
 * When A starts playing (cloud.seam_lead), the seam provider asks here before it chooses itself.
 * With planning on, both songs playing from this device's own files, both measured here and in the
 * account: `POST /api/planning/candidates` ranks every way from A into B, and the best one this
 * device's live engine can play exactly as planned is scheduled. Its move comes through the one
 * table in plannerMoves.ts; its exit and entry are the planner's cue times on the beat grids this
 * device measured (the account planned from those same numbers), never "the end of the song" and
 * "second 0". A choice the engine would have to change (shorten, swap a move, fade) is passed over
 * for the next; none left, a failed or slow call, or an exit already too close, and the device
 * chooses as before. The repair loop (`next-step`) is never asked: nothing is rendered and heard
 * ahead of time in the live engine, so there is no audit for it to read.
 *
 * With cloud.device_render on, the planner's choice is first asked of this device's studio
 * (deviceStudio.ts), which renders, checks and repairs it ahead of time; a clip ready in time is
 * played between the two songs (`account-rendered`), with the live plan above kept as what plays
 * instead if the clip cannot be used after all. No clip in time, and everything is as above.
 */

/** The account's list and the candidates together may take this long; a slower answer is late. */
export const PAIR_WITHIN_MS = 10_000;
/** A planned exit this close to where A is playing is too late to prepare well. */
export const LATE_GUARD_SECONDS = 8;
/** How far down the ranked list to look for a move the live engine plays as planned. */
export const CANDIDATES_TRIED = 24;
/** A schedule must start this close to the planner's exit to count as the planner's. */
const AT_EXIT_SECONDS = 0.05;

/** A cue as `repair.Option` sends it: bar, time, kind, quality, vocal-free bars. */
type CueJson = [number, number, string, number, number];
type OptionJson = { move: string; bars: number; exit_cue: CueJson; entry_cue: CueJson };
type CandidatesAnswer = { options: { index: number; option: OptionJson }[]; fallback?: { option: OptionJson } };

export type PlannedSeam = { scripted: ScriptRequest; schedule: SeamSchedule };
/** The account's plan, or why it wasn't used (said on the seam's record), or null: not asked. */
export type AccountSeamAnswer = PlannedSeam | { declined: string } | null;

export type AccountSeamAsk = {
  fromIndex: number;
  toIndex: number;
  /** The two decoded songs' lengths, which the schedule is checked against. */
  fromSeconds: number;
  toSeconds: number;
  settings: { move?: string | null; exit_bar?: number | null; entry_bar?: number | null };
  abilities: SeamAbilities;
  allowed?: readonly string[];
  /** The two decoded songs and the levels they play at, for a clip rendered ahead. */
  from?: AudioBuffer;
  to?: AudioBuffer;
  fromLevel?: number;
  toLevel?: number;
};

export type AccountSeamSources = {
  request: Request;
  workspaceId: string;
  /** The account's song id of the file playing at a mix position from this device's own files,
   * null when it plays from anywhere else (a hosted copy) or isn't resolved yet. */
  fileOf(index: number): number | null;
  /** That file's content hash, from this device's song index. */
  shaOf(songId: number): Promise<string | null>;
  facts?(sha: string): Promise<SongFacts | null>;
  /** Which mix position is playing and how far into it, or null when unknown. */
  heard?(): { index: number; seconds: number } | null;
  within?: number;
  /** This device's studio (cloud.device_render); without it nothing is rendered ahead. */
  studio?: DeviceStudio | null;
};

/** A song's timing from its measured beat grid, for the live engine. */
export function measuredTiming(facts: SongFacts, seconds: number): TrackTiming | null {
  if (!facts.row || !facts.arrays || facts.row.beats_per_bar !== BEATS_PER_BAR) return null;
  return {
    beats: Array.from(facts.arrays.beats),
    tempo: { bpm: facts.row.bpm, confidence: facts.row.grid_confidence, ambiguous: false },
    durationSeconds: seconds,
  };
}

/** Where a planned option leaves A and enters B, in seconds on each song's grid. A blend's exit
 * cue ends the overlap (`recipes.timing.blend_timing` plays bars `exit - bars` to `exit`), and the
 * live engine wants where it starts. */
export function cueSeconds(option: OptionJson, a: SongFacts, beatmatched: boolean): { exit: number; entry: number } | null {
  const [exitBar, exitTime] = option.exit_cue;
  const entry = option.entry_cue[1];
  if (!Number.isFinite(exitTime) || !Number.isFinite(entry) || entry < 0) return null;
  if (!beatmatched) return { exit: exitTime, entry };
  const starts = a.arrays?.bar_starts;
  const beats = a.arrays?.beats;
  const startBar = exitBar - option.bars;
  if (!starts || !beats || !(option.bars > 0) || startBar < 0 || startBar >= starts.length) return null;
  const exit = beats[starts[startBar]];
  return Number.isFinite(exit) ? { exit, entry } : null;
}

/** The live schedule for one planned option, or null when the engine would change it. */
export function playAsPlanned(option: OptionJson, a: SongFacts, b: SongFacts, ask: AccountSeamAsk, heard: { index: number; seconds: number } | null): PlannedSeam | 'late' | null {
  const move = liveMoveFor(option.move);
  if (!move || (ask.allowed && !ask.allowed.includes(move.live))) return null;
  const cues = cueSeconds(option, a, move.beatmatched);
  const ta = measuredTiming(a, ask.fromSeconds);
  const tb = measuredTiming(b, ask.toSeconds);
  if (!cues || !ta || !tb) return null;
  if (heard && heard.index === ask.fromIndex && cues.exit - heard.seconds < LATE_GUARD_SECONDS) return 'late';
  const scripted: ScriptRequest = {
    a: ta, b: tb, move: move.live, bars: move.beatmatched ? option.bars : null,
    exitSeconds: cues.exit, entrySeconds: cues.entry, abilities: ask.abilities, allowed: ask.allowed,
  };
  const schedule = scriptSeam(scripted);
  const asPlanned = schedule.kind === 'beatmatch' && !schedule.degraded?.length && schedule.style === move.live
    && (!move.beatmatched || schedule.bars === option.bars)
    && Math.abs(schedule.startSeconds - cues.exit) <= AT_EXIT_SECONDS;
  if (!asPlanned) return null;
  return { scripted, schedule: { ...schedule, why: PLANNED_TRANSITION_WHY, chosenBy: { by: 'account' } } };
}

/** The account's choice for one transition. Never throws: a problem is a reason the device chose. */
export function accountSeamPlanner(sources: AccountSeamSources): (ask: AccountSeamAsk) => Promise<AccountSeamAnswer> {
  const within = sources.within ?? PAIR_WITHIN_MS;
  const factsOf = sources.facts ?? ((sha: string) => songFacts(sha));
  return async (ask) => {
    if (!planningOn()) return null;
    // the member chose this transition themselves: theirs, not the planner's
    const move = ask.settings.move;
    if ((move && move !== 'auto') || ask.settings.exit_bar != null || ask.settings.entry_bar != null) return null;
    const songA = sources.fileOf(ask.fromIndex);
    const songB = sources.fileOf(ask.toIndex);
    if (songA === null || songB === null || songA === songB) return { declined: 'a song is not playing from this device’s own files' };
    const started = Date.now();
    try {
      const [shaA, shaB] = await Promise.all([sources.shaOf(songA), sources.shaOf(songB)]);
      const [a, b] = await Promise.all([shaA ? factsOf(shaA) : null, shaB ? factsOf(shaB) : null]);
      if (!a?.row || !b?.row) return { declined: `a song is not measured on this device at ${factsVersion()}` };
      const account = await answerWithin(accountMeasured(sources.request, sources.workspaceId), within);
      if (!account.has(songA) || !account.has(songB)) return { declined: 'a song is not measured in the account yet' };
      const left = within - (Date.now() - started);
      if (left <= 0) return { declined: 'the account took too long to answer' };
      // with the studio on, one answer (with scripts) serves the clip and the live plan
      const studio = sources.studio && deviceRenderOn() && ask.from && ask.to && shaA && shaB ? sources.studio : null;
      const answer = studio
        ? await answerWithin(studio.candidates(songA, songB), left)
        : await askWithin<CandidatesAnswer>(sources.request, '/planning/candidates', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: songA, b: songB, leave_after: LEAVE_AFTER_SECONDS, scripts: 0 }),
        }, left);
      const ranked = [...(answer?.options ?? []).slice(0, CANDIDATES_TRIED).map((entry) => entry.option), ...(answer?.fallback ? [answer.fallback.option] : [])];
      const heard = sources.heard?.() ?? null;
      let late = false;
      let live: PlannedSeam | null = null;
      for (const option of ranked) {
        if (!option || typeof option.move !== 'string' || !Array.isArray(option.exit_cue) || !Array.isArray(option.entry_cue)) continue;
        const planned = playAsPlanned(option, a, b, ask, heard);
        if (planned === 'late') { late = true; continue; }
        if (planned) { live = planned; break; }
      }
      if (studio && answer) {
        const levels = { a: ask.fromLevel ?? 1, b: ask.toLevel ?? 1 };
        const made = await studio.clipFor({ a: { songId: songA, sha: shaA! }, b: { songId: songB, sha: shaB! }, from: ask.from!, to: ask.to!, levels }, renderWaitMs(answer, a, heard, ask));
        const plan = made?.status === 'clip' ? renderedPlan(made, live, a, b, ask) : null;
        if (plan) return plan;
        const note = made ? `not rendered: ${made.status === 'none' ? made.reason : 'it could not be played here'}` : 'not rendered in time';
        if (live) return { ...live, schedule: { ...live.schedule, chosenBy: { by: 'account', note } } };
      }
      if (live) return live;
      return { declined: late ? 'the planned exit was too close to prepare' : 'no planned move plays here as planned' };
    } catch (problem) {
      return { declined: `the account could not be asked: ${problem instanceof Error ? problem.message : String(problem)}` };
    }
  };
}
