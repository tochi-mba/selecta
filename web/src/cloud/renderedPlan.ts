import { PLANNED_TRANSITION_WHY } from '../copy';
import type { SongFacts } from '../dsp/analysis/song';
import type { MadeSeam } from '../dsp/render/seamMaker';
import type { SeamSchedule } from '../dsp/seams';
import { joinSamples, renderedProblem } from '../engine/renderedSeam';
import { cueSeconds, LATE_GUARD_SECONDS, measuredTiming, type AccountSeamAnswer, type AccountSeamAsk, type PlannedSeam } from './accountSeams';
import type { CandidatesAnswer } from './deviceStudio';
import { liveMoveFor } from './plannerMoves';

/** The planner's choice rendered ahead, as the seam the scheduler plays (cloud.device_render;
 * docs/engineering/device-studio-playback.md). The schedule's start and window describe the clip's
 * span on A, its events where native B comes in, so every surface reading a schedule still reads it
 * right; the clip itself rides in `rendered`, and the live plan, when there is one, in `instead`. */

/** The provider waits at most this long for a clip still being made. */
export const RENDER_WAIT_MS = 90_000;
/** ...and never past this long before the planner's first choice would leave the playing song,
 * on top of the live plan's own guard, so the live plan still has time to be prepared. */
const MARGIN_SECONDS = 4;

/** How long the provider may wait for this seam's clip: while the outgoing song plays, until a
 * little before the top-ranked choice would start. Nothing is waited for once that has passed. */
export function renderWaitMs(answer: CandidatesAnswer | { options?: { option: Parameters<typeof cueSeconds>[0] }[] }, a: SongFacts, heard: { index: number; seconds: number } | null, ask: AccountSeamAsk): number {
  const top = answer.options?.[0]?.option;
  if (!top || typeof top.move !== 'string' || !Array.isArray(top.exit_cue)) return 0;
  // a move the live engine does not know is read as a blend, whose overlap starts earliest
  const cues = cueSeconds(top, a, liveMoveFor(top.move)?.beatmatched ?? true);
  if (!cues) return 0;
  const at = heard && heard.index === ask.fromIndex ? heard.seconds : 0;
  const room = cues.exit - at - LATE_GUARD_SECONDS - MARGIN_SECONDS;
  return Math.max(0, Math.min(RENDER_WAIT_MS, room * 1000));
}

/** The seam record's account of how the studio got there: no audio, nothing personal. */
export function studioNote(made: MadeSeam): NonNullable<SeamSchedule['studio']> {
  return {
    move: made.move,
    passed: made.passed,
    nearMiss: made.nearMiss,
    fellBack: made.fellBack,
    tookMs: made.tookMs,
    implementation: made.implementation,
    attempts: made.attempts.map((attempt) => ({
      option: attempt.option,
      move: attempt.move,
      passed: attempt.facts ? attempt.facts.passed : null,
      failed: attempt.facts ? attempt.facts.failures.map((check) => check.name) : [],
      skipped: attempt.skipped,
      tightened: attempt.tightened,
      ms: attempt.ms,
    })),
  };
}

/** The rendered seam for the scheduler, or null when the songs' timing is not known. */
export function renderedPlan(made: MadeSeam, live: PlannedSeam | null, a: SongFacts, b: SongFacts, ask: AccountSeamAsk): PlannedSeam | null {
  const ta = measuredTiming(a, ask.fromSeconds);
  const tb = measuredTiming(b, ask.toSeconds);
  if (!ta || !tb) return null;
  const clip = made.rendered;
  const rate = clip.sampleRate;
  const length = clip.channels[0].length;
  const seam = joinSamples(rate);
  const startSeconds = clip.aStartSample / rate;
  const schedule: SeamSchedule = {
    implementation: clip.implementation,
    kind: made.beatsAligned ? 'beatmatch' : 'fade',
    startSeconds,
    windowSeconds: length / rate,
    events: [
      { deck: 'b', kind: 'start', at: startSeconds + (length - seam) / rate, sourceAt: (clip.bEndSample - seam) / rate },
      { deck: 'a', kind: 'stop', at: startSeconds + seam / rate },
    ],
    style: made.move,
    why: PLANNED_TRANSITION_WHY,
    chosenBy: { by: 'account-rendered' },
    rendered: clip,
    instead: live?.schedule,
    studio: studioNote(made),
  };
  return { scripted: live?.scripted ?? { a: ta, b: tb, abilities: ask.abilities, allowed: ask.allowed }, schedule };
}

type Decoded = { length?: number; duration: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };
const asSong = (audio: Decoded) => ({
  length: audio.length ?? Math.round(audio.duration * audio.sampleRate),
  sampleRate: audio.sampleRate,
  numberOfChannels: audio.numberOfChannels,
  getChannelData: (channel: number) => audio.getChannelData(channel),
});

/** A rendered plan checked against the songs the scheduler is about to play: one that does not
 * fit them gives way to the live plan it carries, or to this device's own choice, before anything
 * is recorded as planned. Any other answer is returned as it came. */
export function settleRendered(answer: AccountSeamAnswer, request: { from: Decoded; to: Decoded; fromLevel?: number; toLevel?: number }): AccountSeamAnswer {
  const rendered = answer && 'schedule' in answer ? answer.schedule.rendered : undefined;
  if (!answer || !('schedule' in answer) || !rendered) return answer;
  const problem = renderedProblem(rendered, asSong(request.from), asSong(request.to), { a: request.fromLevel ?? 1, b: request.toLevel ?? 1 }, request.from.sampleRate);
  if (!problem) return answer;
  const note = `not rendered: ${problem}`;
  if (answer.schedule.instead) return { scripted: answer.scripted, schedule: { ...answer.schedule.instead, chosenBy: { by: 'account', note } } };
  return { declined: note };
}
