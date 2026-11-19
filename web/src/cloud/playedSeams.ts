import type { SeamSchedule } from '../dsp/seams';
import type { PlayedSeam } from '../views/liveTransitions';
import { playedKey } from '../views/liveTransitions';
import { BROWSER_MOVE_WORDS } from './browserMoves';
import type { PlayedRecord } from './localFirstPlayer';

const sentence = (text: string) => {
  const trimmed = text.trim().replace(/[.\s]*$/, '');
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}.` : '';
};

/** One scheduled seam as the editor says it: what was scheduled on this device, never what a
 * listener heard (dsp/seamProvider.ts records schedules, not sound). */
export function playedWords(schedule: SeamSchedule): PlayedSeam {
  const reasons = (schedule.degraded ?? []).map((degrade) => degrade.reason);
  if (schedule.kind === 'fade') {
    return { label: 'Faded', detail: reasons.length ? sentence(reasons[reasons.length - 1]) : null, fellBack: true };
  }
  const style = schedule.style ?? 'blend';
  const name = BROWSER_MOVE_WORDS[style as keyof typeof BROWSER_MOVE_WORDS]?.label ?? style.replaceAll('_', ' ');
  const label = schedule.bars ? `${name}, ${schedule.bars} bars` : name;
  const shortened = schedule.degraded?.length ? `Shortened: ${sentence(reasons.join('; '))}` : null;
  const nudged = schedule.rate && !schedule.why
    ? `The next song’s speed was nudged ${((Math.abs(schedule.rate.value - 1)) * 100).toFixed(1)} percent to match, then eased back.`
    : null;
  return { label, detail: [schedule.why ?? null, nudged, shortened].filter(Boolean).join(' ') || null, fellBack: false };
}

/** The latest scheduled seam for each pair of songs, keyed as the editor looks them up. */
export function playedByPair(records: readonly PlayedRecord[]): Record<string, PlayedSeam> {
  const played: Record<string, PlayedSeam> = {};
  for (const record of records) {
    const [from, into] = record.pair ?? [null, null];
    if (from === null || into === null) continue;
    played[playedKey(from, into)] = playedWords(record.schedule);
  }
  return played;
}
