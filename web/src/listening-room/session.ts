/** The Listening Room's session (tools.listening_room): what is compared, how A and B are dealt,
 * what the listener said, and the reveal. Pure and free of React and audio, so every rule here is
 * tested on its own (session.test.ts).
 *
 * A session is a list of trials. A trial is one transition heard two ways (two variants), blind:
 * which variant is called A and which B is dealt per trial from a seeded generator, and the seed
 * and the deal are kept in the session but shown only on the reveal.
 *
 * Variants are a union so later sessions can also compare audio clips at an address (a seam
 * rendered by Desktop or the server); version 1 builds and plays only the live kind, where the
 * browser engine plays the transition on this device with the options the variant names.
 */

export const SESSION_SCHEMA = 1;
export const RESULTS_SCHEMA = 'selectadj.listening-room.results/1';
/** At most this many transitions in one session. */
export const MAX_TRIALS = 8;
/** About how long one trial takes to hear both ways and answer, for the start screen. */
export const SECONDS_PER_TRIAL = 150;

export type Label = 'A' | 'B';
export const LABELS: readonly Label[] = ['A', 'B'];

/** The browser engine plays the transition here with these options (cloud.seam_lead's three). */
export type LiveVariant = { kind: 'live'; id: string; name: string; planAhead: boolean; levels: boolean; patient: boolean };
/** A finished recording of the transition at an address. Not played by version 1. */
export type ClipVariant = { kind: 'clip'; id: string; name: string; url: string; transitionAt?: number };
export type Variant = LiveVariant | ClipVariant;

/** Before cloud.seam_lead: planned 45 s from the end, every song at its own level, impatient analysis. */
export const BEFORE: LiveVariant = { kind: 'live', id: 'before', name: 'Before', planAhead: false, levels: false, patient: false };
/** With cloud.seam_lead: planned as the song starts, one level for every song, patient analysis. */
export const AFTER: LiveVariant = { kind: 'live', id: 'after', name: 'After', planAhead: true, levels: true, patient: true };

export type SongRef = { songId: number; position: number; title: string; artist: string; duration: number };
export type Trial = {
  id: string;
  from: SongRef;
  to: SongRef;
  variants: readonly [Variant, Variant];
  /** Which variant id each label plays. Hidden until the reveal. */
  labels: Record<Label, string>;
};

export type Verdict = 'a_better' | 'b_better' | 'same' | 'both_bad' | 'cant_judge';
export const VERDICTS: readonly { id: Verdict; words: string; key: string }[] = [
  { id: 'a_better', words: 'A is better', key: 'Q' },
  { id: 'b_better', words: 'B is better', key: 'W' },
  { id: 'same', words: 'No difference', key: 'E' },
  { id: 'both_bad', words: 'Both are bad', key: 'R' },
  { id: 'cant_judge', words: 'Can’t judge', key: 'T' },
];

export type Reason = 'beats_off' | 'level_jump' | 'cut_line' | 'cold_landing' | 'clash' | 'too_long' | 'too_short' | 'too_sudden';
export const REASONS: readonly { id: Reason; words: string }[] = [
  { id: 'beats_off', words: 'Beats off' },
  { id: 'level_jump', words: 'Level jump' },
  { id: 'cut_line', words: 'Cut off a line' },
  { id: 'cold_landing', words: 'Cold landing' },
  { id: 'clash', words: 'Clash' },
  { id: 'too_long', words: 'Too long' },
  { id: 'too_short', words: 'Too short' },
  { id: 'too_sudden', words: 'Too sudden' },
];
export const NOTE_LIMIT = 280;

/** What really played for one variant, read from the engine after the audition. */
export type Played = {
  /** scheduler.ts TransitionKind, or 'not_reached' when the audition ended before it. */
  kind: 'seam_schedule' | 'boundary' | 'fallback_fade' | 'late_fade' | 'not_reached';
  seamKind?: 'beatmatch' | 'fade';
  style?: string;
  bars?: number;
  windowSeconds?: number;
  startSeconds?: number;
  stretched?: boolean;
  reason?: string;
  /** The linear gain each song played at (1 when levels were off). */
  levels?: { from?: number; to?: number };
  /** The first song's level arrived after the engine stopped waiting for it, so it began at 1. */
  levelLate?: boolean;
  at: number;
};

export type Answer = {
  verdict: Verdict | null;
  reasons: Reason[];
  note: string;
  replays: Record<Label, number>;
  played: Partial<Record<Label, Played>>;
  /** Why this trial could not be prepared or played; only Can't judge is then offered. */
  failed: string | null;
  /** Where the transition starts on the first song, from preparing the trial once. */
  startSeconds: number | null;
  answeredAt: number | null;
};

export type Session = {
  schema: typeof SESSION_SCHEMA;
  id: string;
  workspaceId: string;
  mixId: string | null;
  mixName: string;
  /** The mix's song ids in order when the session was made, to tell whether it still matches. */
  mixSignature: string;
  seed: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** The trial on screen, or trials.length on the reveal. */
  position: number;
  trials: Trial[];
  answers: Record<string, Answer>;
  /** The flag states when the session was made, for the export. */
  flags: Record<string, boolean>;
};

/** A small seeded generator (mulberry32): the same seed always deals the same labels. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with the seeded generator: stable for a seed, a real shuffle across seeds. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1));
    [out[index], out[pick]] = [out[pick], out[index]];
  }
  return out;
}

/** Which variant each label plays for every trial, dealt from one seed in trial order. */
export function dealLabels(seed: number, variantIds: readonly (readonly [string, string])[]): Record<Label, string>[] {
  const random = seeded(seed);
  return variantIds.map((pair) => {
    const [a, b] = shuffled(pair, random);
    return { A: a, B: b };
  });
}

export function newSeed(random: () => number = Math.random): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const made = new Uint32Array(1);
    crypto.getRandomValues(made);
    return made[0];
  }
  return Math.floor(random() * 4294967296) >>> 0;
}

export type MixSong = { song_id: number; title: string; artist: string; duration: number };

/** The transitions to compare: adjacent pairs whose two songs both play here, at most `max`,
 * spread evenly across the mix (always the first and the last when there are more than enough). */
export function chooseTransitions(mix: readonly MixSong[], playable: (songId: number) => boolean, max = MAX_TRIALS): number[] {
  const candidates: number[] = [];
  for (let index = 0; index + 1 < mix.length; index += 1) {
    if (playable(mix[index].song_id) && playable(mix[index + 1].song_id)) candidates.push(index);
  }
  if (candidates.length <= max) return candidates;
  if (max <= 1) return candidates.slice(0, Math.max(0, max));
  const picked = new Set<number>();
  for (let step = 0; step < max; step += 1) picked.add(candidates[Math.round((step * (candidates.length - 1)) / (max - 1))]);
  return [...picked].sort((left, right) => left - right);
}

export const mixSignature = (mix: readonly { song_id: number }[]): string => mix.map((item) => item.song_id).join(',');

const songRef = (mix: readonly MixSong[], position: number): SongRef => ({
  songId: mix[position].song_id,
  position,
  title: mix[position].title || `Song ${position + 1}`,
  artist: mix[position].artist || '',
  duration: mix[position].duration,
});

export function emptyAnswer(): Answer {
  return { verdict: null, reasons: [], note: '', replays: { A: 0, B: 0 }, played: {}, failed: null, startSeconds: null, answeredAt: null };
}

export type NewSession = {
  workspaceId: string;
  mixId: string | null;
  mixName: string;
  mix: readonly MixSong[];
  playable: (songId: number) => boolean;
  seed?: number;
  now?: number;
  flags?: Record<string, boolean>;
  variants?: readonly [Variant, Variant];
  id?: string;
};

/** A new session over the mix, or null when it has no transition that plays here. */
export function createSession(options: NewSession): Session | null {
  const chosen = chooseTransitions(options.mix, options.playable);
  if (!chosen.length) return null;
  const seed = options.seed ?? newSeed();
  const now = options.now ?? Date.now();
  const variants = options.variants ?? [BEFORE, AFTER] as const;
  const labels = dealLabels(seed, chosen.map(() => [variants[0].id, variants[1].id] as const));
  const trials: Trial[] = chosen.map((position, index) => ({
    id: `t${index + 1}-${options.mix[position].song_id}-${options.mix[position + 1].song_id}`,
    from: songRef(options.mix, position),
    to: songRef(options.mix, position + 1),
    variants,
    labels: labels[index],
  }));
  return {
    schema: SESSION_SCHEMA,
    id: options.id ?? `s${now.toString(36)}${(seed % 1679616).toString(36)}`,
    workspaceId: options.workspaceId,
    mixId: options.mixId,
    mixName: options.mixName,
    mixSignature: mixSignature(options.mix),
    seed,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    position: 0,
    trials,
    answers: Object.fromEntries(trials.map((trial) => [trial.id, emptyAnswer()])),
    flags: options.flags ?? {},
  };
}

export const answerOf = (session: Session, trialId: string): Answer => session.answers[trialId] ?? emptyAnswer();
export const variantOf = (trial: Trial, label: Label): Variant => trial.variants.find((variant) => variant.id === trial.labels[label]) ?? trial.variants[0];

function withAnswer(session: Session, trialId: string, change: (answer: Answer) => Answer, now = Date.now()): Session {
  if (!session.trials.some((trial) => trial.id === trialId)) return session;
  return { ...session, updatedAt: now, answers: { ...session.answers, [trialId]: change(answerOf(session, trialId)) } };
}

/** The verdicts a trial may take: a trial that could not be prepared or played takes only Can't judge. */
export function allowedVerdicts(answer: Answer): Verdict[] {
  return answer.failed ? ['cant_judge'] : VERDICTS.map((verdict) => verdict.id);
}

/** Choose a verdict. One that the trial does not allow is ignored. Choosing the same again clears it. */
export function chooseVerdict(session: Session, trialId: string, verdict: Verdict, now = Date.now()): Session {
  const answer = answerOf(session, trialId);
  if (!allowedVerdicts(answer).includes(verdict)) return session;
  return withAnswer(session, trialId, (kept) => (kept.verdict === verdict
    ? { ...kept, verdict: null, answeredAt: null }
    : { ...kept, verdict, answeredAt: now }), now);
}

export function toggleReason(session: Session, trialId: string, reason: Reason, now = Date.now()): Session {
  return withAnswer(session, trialId, (kept) => ({
    ...kept,
    reasons: kept.reasons.includes(reason) ? kept.reasons.filter((item) => item !== reason) : REASONS.map((item) => item.id).filter((id) => id === reason || kept.reasons.includes(id)),
  }), now);
}

export function setNote(session: Session, trialId: string, note: string, now = Date.now()): Session {
  return withAnswer(session, trialId, (kept) => ({ ...kept, note: note.slice(0, NOTE_LIMIT) }), now);
}

export function countReplay(session: Session, trialId: string, label: Label, now = Date.now()): Session {
  return withAnswer(session, trialId, (kept) => ({ ...kept, replays: { ...kept.replays, [label]: kept.replays[label] + 1 } }), now);
}

export function recordPlayed(session: Session, trialId: string, label: Label, played: Played, now = Date.now()): Session {
  return withAnswer(session, trialId, (kept) => ({ ...kept, played: { ...kept.played, [label]: played } }), now);
}

export function recordPrepared(session: Session, trialId: string, startSeconds: number, now = Date.now()): Session {
  return withAnswer(session, trialId, (kept) => ({ ...kept, startSeconds, failed: null }), now);
}

/** A trial that could not be prepared or played: any verdict but Can't judge is dropped. */
export function recordFailure(session: Session, trialId: string, why: string, now = Date.now()): Session {
  return withAnswer(session, trialId, (kept) => ({
    ...kept,
    failed: why,
    verdict: kept.verdict === 'cant_judge' ? kept.verdict : null,
    answeredAt: kept.verdict === 'cant_judge' ? kept.answeredAt : null,
  }), now);
}

/** Move to a trial (or to the reveal at trials.length). Reaching the reveal finishes the session. */
export function goTo(session: Session, position: number, now = Date.now()): Session {
  const clamped = Math.max(0, Math.min(session.trials.length, Math.round(position)));
  return {
    ...session,
    position: clamped,
    updatedAt: now,
    finishedAt: clamped === session.trials.length ? session.finishedAt ?? now : session.finishedAt,
  };
}

/** The next trial without a verdict after `from`, wrapping round; the reveal when every one has one. */
export function nextOpen(session: Session, from = session.position): number {
  const count = session.trials.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count;
    if (!answerOf(session, session.trials[index].id).verdict) return index;
  }
  return count;
}

export const answeredCount = (session: Session): number => session.trials.filter((trial) => answerOf(session, trial.id).verdict).length;

/** What a verdict says about the variants, with A and B resolved: a vote names the variant that
 * won; no difference, both bad and can't judge name none. Can't judge never counts as a vote. */
export type Outcome = { kind: 'won'; variant: string } | { kind: 'same' } | { kind: 'both_bad' } | { kind: 'cant_judge' } | { kind: 'open' };
export function outcomeOf(trial: Trial, answer: Answer): Outcome {
  if (answer.failed && answer.verdict !== 'cant_judge') return answer.verdict ? { kind: 'cant_judge' } : { kind: 'open' };
  switch (answer.verdict) {
    case 'a_better': return { kind: 'won', variant: trial.labels.A };
    case 'b_better': return { kind: 'won', variant: trial.labels.B };
    case 'same': return { kind: 'same' };
    case 'both_bad': return { kind: 'both_bad' };
    case 'cant_judge': return { kind: 'cant_judge' };
    default: return { kind: 'open' };
  }
}

export type Tally = { wins: Record<string, number>; same: number; bothBad: number; cantJudge: number; open: number; votes: number };
export function tally(session: Session): Tally {
  const wins: Record<string, number> = {};
  for (const variant of session.trials[0]?.variants ?? []) wins[variant.id] = 0;
  const counted: Tally = { wins, same: 0, bothBad: 0, cantJudge: 0, open: 0, votes: 0 };
  for (const trial of session.trials) {
    const outcome = outcomeOf(trial, answerOf(session, trial.id));
    if (outcome.kind === 'won') {
      counted.wins[outcome.variant] = (counted.wins[outcome.variant] ?? 0) + 1;
      counted.votes += 1;
    } else if (outcome.kind === 'same') counted.same += 1;
    else if (outcome.kind === 'both_bad') counted.bothBad += 1;
    else if (outcome.kind === 'cant_judge') counted.cantJudge += 1;
    else counted.open += 1;
  }
  return counted;
}

// ---- saving in this browser -------------------------------------------------------------------

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'selecta.listeningRoom';
export const sessionKey = (workspaceId: string, sessionId: string) => `${PREFIX}.${workspaceId}.session.${sessionId}`;
export const currentKey = (workspaceId: string) => `${PREFIX}.${workspaceId}.current`;

export function saveSession(storage: StorageLike | null, session: Session): boolean {
  if (!storage) return false;
  try {
    storage.setItem(sessionKey(session.workspaceId, session.id), JSON.stringify(session));
    storage.setItem(currentKey(session.workspaceId), session.id);
    return true;
  } catch {
    return false;
  }
}

/** Whether a parsed value is a session this version can carry on. */
export function isSession(value: unknown): value is Session {
  const kept = value as Session | null;
  return !!kept && typeof kept === 'object' && kept.schema === SESSION_SCHEMA && typeof kept.id === 'string'
    && typeof kept.workspaceId === 'string' && Array.isArray(kept.trials) && kept.trials.length > 0
    && typeof kept.answers === 'object' && kept.answers !== null && Number.isFinite(kept.seed) && Number.isFinite(kept.position)
    && kept.trials.every((trial) => trial && typeof trial.id === 'string' && Array.isArray(trial.variants) && trial.variants.length === 2 && !!trial.labels?.A && !!trial.labels?.B);
}

/** The session this browser was last in for the workspace, as it was left, or null. */
export function loadSession(storage: StorageLike | null, workspaceId: string): Session | null {
  if (!storage) return null;
  try {
    const id = storage.getItem(currentKey(workspaceId));
    if (!id) return null;
    const raw = storage.getItem(sessionKey(workspaceId, id));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isSession(parsed) || parsed.workspaceId !== workspaceId) return null;
    const answers = Object.fromEntries(parsed.trials.map((trial) => [trial.id, { ...emptyAnswer(), ...parsed.answers[trial.id] }]));
    return { ...parsed, answers, position: Math.max(0, Math.min(parsed.trials.length, Math.round(parsed.position))) };
  } catch {
    return null;
  }
}

/** Forget which session is current (its answers stay saved under their own key). */
export function leaveSession(storage: StorageLike | null, workspaceId: string): void {
  try {
    storage?.removeItem(currentKey(workspaceId));
  } catch {
    // an unwritable store only means the next visit offers this session again
  }
}

// ---- the reveal and the export ----------------------------------------------------------------

const seconds = (value: number) => `${Math.round(value)} second${Math.round(value) === 1 ? '' : 's'}`;
const styleWords = (style?: string) => {
  if (!style || style === 'blend' || style === 'beatmatch') return 'Blend';
  const plain = style.replace(/_/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};

/** What played, in plain words. */
export function playedWords(played: Played | undefined): string {
  if (!played) return 'Not played';
  switch (played.kind) {
    case 'seam_schedule':
      if (played.seamKind === 'beatmatch') {
        const span = played.bars ? `over ${played.bars} bar${played.bars === 1 ? '' : 's'}` : played.windowSeconds ? `over ${seconds(played.windowSeconds)}` : '';
        return `${styleWords(played.style)} ${span}, both in time${played.stretched ? ', the next song eased to the same tempo' : ''}`.replace(/ +,/g, ',');
      }
      return `A ${seconds(played.windowSeconds ?? 3)} fade: the beats could not be matched with confidence`;
    case 'fallback_fade':
      return /too late/.test(played.reason ?? '')
        ? 'A 3 second fade: the transition was ready too late'
        : 'A 3 second fade: the planned transition could not be used';
    case 'late_fade': return 'A 3 second fade in: the next song was ready too late';
    case 'boundary': return 'Straight from one song into the next';
    default: return 'The transition was not reached';
  }
}

const gainDb = (gain: number | undefined) => (gain && gain > 0 ? 20 * Math.log10(gain) : null);
export function levelWords(played: Played | undefined): string {
  if (!played?.levels) return '';
  const part = (name: string, gain?: number) => {
    const db = gainDb(gain);
    return db === null ? `${name} not measured` : `${name} ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  };
  return `Level: ${part('first song', played.levels.from)}, ${part('second song', played.levels.to)}${played.levelLate ? ' (the first song began before its level was ready)' : ''}`;
}

export type ResultsMeta = { build: string | null; exportedAt?: number };

/** The whole session as a versioned JSON document, A and B resolved. */
export function resultsJson(session: Session, meta: ResultsMeta) {
  const counted = tally(session);
  return {
    schema: RESULTS_SCHEMA,
    sessionSchema: session.schema,
    build: meta.build,
    exportedAt: new Date(meta.exportedAt ?? Date.now()).toISOString(),
    session: {
      id: session.id,
      mixId: session.mixId,
      mixName: session.mixName,
      seed: session.seed,
      createdAt: new Date(session.createdAt).toISOString(),
      finishedAt: session.finishedAt === null ? null : new Date(session.finishedAt).toISOString(),
      flags: session.flags,
    },
    tally: { ...counted.wins, noDifference: counted.same, bothBad: counted.bothBad, cantJudge: counted.cantJudge, unanswered: counted.open },
    trials: session.trials.map((trial, index) => {
      const answer = answerOf(session, trial.id);
      const outcome = outcomeOf(trial, answer);
      return {
        number: index + 1,
        from: trial.from,
        to: trial.to,
        variants: trial.variants,
        labels: trial.labels,
        verdict: answer.verdict,
        winner: outcome.kind === 'won' ? outcome.variant : null,
        reasons: answer.reasons,
        note: answer.note,
        replays: answer.replays,
        failed: answer.failed,
        startSeconds: answer.startSeconds,
        answeredAt: answer.answeredAt === null ? null : new Date(answer.answeredAt).toISOString(),
        played: Object.fromEntries(LABELS.map((label) => [label, answer.played[label] ? { ...answer.played[label], words: playedWords(answer.played[label]) } : null])),
      };
    }),
  };
}

const verdictWords = (verdict: Verdict | null) => VERDICTS.find((item) => item.id === verdict)?.words ?? 'No answer';
const reasonWords = (reasons: readonly Reason[]) => reasons.map((reason) => REASONS.find((item) => item.id === reason)?.words ?? reason).join(', ');
const nameOf = (trial: Trial, id: string) => trial.variants.find((variant) => variant.id === id)?.name ?? id;

/** The results as plain text to paste anywhere. */
export function resultsText(session: Session, meta: ResultsMeta): string {
  const counted = tally(session);
  const names = session.trials[0]?.variants ?? [];
  const lines = [
    `SelectaDJ Listening Room: ${session.mixName || 'current mix'}`,
    `Session ${session.id}, seed ${session.seed}${meta.build ? `, build ${meta.build}` : ''}`,
    `${names.map((variant) => `${variant.name} won ${counted.wins[variant.id] ?? 0}`).join(', ')}, no difference ${counted.same}, both bad ${counted.bothBad}, can’t judge ${counted.cantJudge}${counted.open ? `, unanswered ${counted.open}` : ''}`,
    '',
  ];
  session.trials.forEach((trial, index) => {
    const answer = answerOf(session, trial.id);
    lines.push(`${index + 1}. ${trial.from.title} into ${trial.to.title}`);
    lines.push(`   A was ${nameOf(trial, trial.labels.A)}, B was ${nameOf(trial, trial.labels.B)}. ${verdictWords(answer.verdict)}.${answer.failed ? ` Could not play: ${answer.failed}.` : ''}`);
    if (answer.reasons.length) lines.push(`   Reasons: ${reasonWords(answer.reasons)}`);
    if (answer.note.trim()) lines.push(`   Note: ${answer.note.trim()}`);
    for (const label of LABELS) {
      const played = answer.played[label];
      lines.push(`   ${label} (${nameOf(trial, trial.labels[label])}), heard ${answer.replays[label]} time${answer.replays[label] === 1 ? '' : 's'}: ${playedWords(played)}${levelWords(played) ? `. ${levelWords(played)}` : ''}`);
    }
  });
  return lines.join('\n');
}
