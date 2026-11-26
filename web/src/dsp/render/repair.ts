/** The repair rule: what to do after a take is rendered and heard. An exact port of
 * src/selecta/planner_core/repair.py, with the same JSON forms, so the Desktop, a cloud worker
 * and this browser decide the same way from the same ranked options and audit facts. */

export const MAX_REPAIRS = 4;

/** How far past its limit a check may land and still count as a near miss. */
export const NEAR_MISS: Readonly<Record<string, number>> = { 'beat alignment': 20.0, 'level fall': 3.0, 'entry level': 1.5 };

export const BEAT_CHECK = 'beat alignment';

export const ACCEPT = 'accept';
export const TRY = 'try';
export const TIGHTEN = 'tighten';
export const KEEP = 'keep';
export const FALLBACK = 'fallback';

export const RULE_SCHEMA = 1;
const TAG = '$type';

type NumberJson = number | { [TAG]: 'float'; value: string };

function writeNumber(value: number): NumberJson {
  if (Number.isFinite(value)) return value;
  return { [TAG]: 'float', value: Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf' };
}

function readNumber(value: unknown): number {
  if (typeof value === 'object' && value !== null && (value as Record<string, unknown>)[TAG] === 'float') {
    const text = String((value as Record<string, unknown>).value).toLowerCase();
    if (text === 'inf' || text === 'infinity' || text === '+inf') return Infinity;
    if (text === '-inf' || text === '-infinity') return -Infinity;
    if (text === 'nan') return NaN;
    return Number(text);
  }
  const number = Number(value);
  if (typeof value === 'boolean' || value === null || value === undefined || Number.isNaN(number)) throw new Error(`${JSON.stringify(value)} is not a number`);
  return number;
}

function readInt(value: unknown): number {
  const number = readNumber(value);
  if (!Number.isFinite(number)) throw new Error(`${JSON.stringify(value)} is not a whole number`);
  return Math.trunc(number);
}

/** One check that did not pass. */
export interface FailedCheck {
  name: string;
  value: number;
  limit: number;
  fix: string | null;
}

export interface AuditFacts {
  passed: boolean;
  failures: FailedCheck[];
}

/** A cue: bar, time, kind, quality, vocal-free bars (every field of `Cue`, in order). */
export type CueFields = [number, number, string, number, number];

export interface Option {
  move: string;
  bars: number;
  exitCue: CueFields;
  entryCue: CueFields;
}

export interface Attempted {
  option: number;
  /** None when the recipe built no script there, so nothing was rendered. */
  audit: AuditFacts | null;
}

export interface RepairStep {
  action: string;
  option: number | null;
  take: number | null;
}

const step = (action: string, option: number | null = null, take: number | null = null): RepairStep => ({ action, option, take });

/** What makes two candidates the same attempt: move, exit bar, entry bar and length. */
function optionKey(option: Option): string {
  return JSON.stringify([option.move, option.exitCue[0], option.entryCue[0], option.bars]);
}

function sameCue(a: CueFields, b: CueFields): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Is this take nearer to clean than that one? Fewer failures first, then by how far over. */
export function closer(facts: AuditFacts, than: AuditFacts): boolean {
  const miss = (f: AuditFacts): [number, number] => {
    // Python's sum() starts at the integer 0 and adds left to right
    let over = 0;
    for (const check of f.failures) over += check.value - check.limit;
    return [f.failures.length, over];
  };
  const [countA, overA] = miss(facts);
  const [countB, overB] = miss(than);
  if (countA !== countB) return countA < countB;
  return overA < overB;
}

/** Passed, or only a near miss on checks that have proved stricter than the ear. */
export function goodEnough(facts: AuditFacts): boolean {
  for (const check of facts.failures) {
    const slack = NEAR_MISS[check.name];
    if (slack === undefined || check.value > check.limit + slack) return false;
  }
  return true;
}

function following(failed: Option, facts: AuditFacts, options: readonly Option[], tried: Set<string>): number | null {
  const fixes = new Set(facts.failures.map((check) => check.fix));
  const remaining = options.map((option, index) => ({ option, index })).filter(({ option }) => !tried.has(optionKey(option)));
  if (fixes.has('shorten')) {
    const shorter = remaining.filter(({ option }) => option.move === failed.move && option.bars < failed.bars);
    if (shorter.length) return shorter[0].index;
  }
  if (fixes.has('move_cue') || fixes.has('close_gap')) {
    const moved = remaining.filter(
      ({ option }) => option.move === failed.move && (!sameCue(option.exitCue, failed.exitCue) || !sameCue(option.entryCue, failed.entryCue)),
    );
    if (moved.length) return moved[0].index;
  }
  const other = remaining.filter(({ option }) => option.move !== failed.move);
  if (other.length) return other[0].index;
  return remaining.length ? remaining[0].index : null;
}

/** What to do after these attempts, best ranked option first (`repair.next_step`). */
export function nextStep(options: readonly Option[], attempts: readonly Attempted[], maxRepairs = MAX_REPAIRS): RepairStep {
  const renders = attempts.filter((attempt) => attempt.audit !== null).length;
  let next: number | null;
  if (attempts.length === 0) {
    next = options.length ? 0 : null;
  } else {
    const last = attempts[attempts.length - 1];
    if (last.audit !== null && last.audit.passed) return step(ACCEPT, last.option);
    const tried = new Set(attempts.map((attempt) => optionKey(optionAt(options, attempt.option))));
    if (last.audit === null) {
      const found = options.findIndex((option) => !tried.has(optionKey(option)));
      next = found < 0 ? null : found;
    } else {
      next = following(optionAt(options, last.option), last.audit, options, tried);
    }
  }
  if (next === null || renders > maxRepairs) return step(FALLBACK);
  return step(TRY, next);
}

/** Python indexes a list from the end with a negative number, and fails past either end. */
function optionAt(options: readonly Option[], index: number): Option {
  const at = index < 0 ? options.length + index : index;
  if (at < 0 || at >= options.length) throw new RangeError(`option ${index} is not in the list`);
  return options[at];
}

/** For one take: TIGHTEN when the beats missed, then KEEP whichever take is closer to clean. */
export function takeStep(first: AuditFacts, second: AuditFacts | null = null): RepairStep {
  if (second === null) {
    if (first.failures.some((check) => check.name === BEAT_CHECK)) return step(TIGHTEN);
    return step(KEEP, null, 0);
  }
  return step(KEEP, null, closer(second, first) ? 1 : 0);
}

// --- JSON forms, as repair.py writes and reads them ---------------------------------------

export function failedCheckToJson(check: FailedCheck): object {
  return { name: check.name, value: writeNumber(check.value), limit: writeNumber(check.limit), fix: check.fix };
}

export function failedCheckFromJson(data: Record<string, unknown>): FailedCheck {
  return { name: String(data.name), value: readNumber(data.value), limit: readNumber(data.limit), fix: data.fix === undefined || data.fix === null ? null : (data.fix as string) };
}

export function auditFactsToJson(facts: AuditFacts): object {
  return { passed: facts.passed, failures: facts.failures.map(failedCheckToJson) };
}

export function auditFactsFromJson(data: Record<string, unknown>): AuditFacts {
  const failures = (data.failures as Record<string, unknown>[] | null | undefined) ?? [];
  return { passed: Boolean(data.passed), failures: failures.map(failedCheckFromJson) };
}

function cueToJson(cue: CueFields): unknown[] {
  return [Math.trunc(cue[0]), writeNumber(cue[1]), String(cue[2]), writeNumber(cue[3]), Math.trunc(cue[4])];
}

function cueFromJson(data: unknown[]): CueFields {
  if (!Array.isArray(data) || data.length !== 5) throw new Error('a cue has five fields');
  return [readInt(data[0]), readNumber(data[1]), String(data[2]), readNumber(data[3]), readInt(data[4])];
}

export function optionToJson(option: Option): object {
  return { move: option.move, bars: Math.trunc(option.bars), exit_cue: cueToJson(option.exitCue), entry_cue: cueToJson(option.entryCue) };
}

export function optionFromJson(data: Record<string, unknown>): Option {
  return { move: String(data.move), bars: readInt(data.bars), exitCue: cueFromJson(data.exit_cue as unknown[]), entryCue: cueFromJson(data.entry_cue as unknown[]) };
}

export function attemptedToJson(attempt: Attempted): object {
  return { option: attempt.option, audit: attempt.audit === null ? null : auditFactsToJson(attempt.audit) };
}

export function attemptedFromJson(data: Record<string, unknown>): Attempted {
  const audit = data.audit;
  return { option: readInt(data.option), audit: audit === undefined || audit === null ? null : auditFactsFromJson(audit as Record<string, unknown>) };
}

export function repairStepToJson(repair: RepairStep): object {
  return { schema: RULE_SCHEMA, action: repair.action, option: repair.option, take: repair.take };
}

export function repairStepFromJson(data: Record<string, unknown>): RepairStep {
  const option = data.option;
  const take = data.take;
  return {
    action: String(data.action),
    option: option === undefined || option === null ? null : readInt(option),
    take: take === undefined || take === null ? null : readInt(take),
  };
}
