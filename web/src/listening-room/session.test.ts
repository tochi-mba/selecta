import { describe, expect, it } from 'vitest';
import { playedFrom, scheduledSpan } from './audition';
import {
  AFTER, allowedVerdicts, answerOf, BEFORE, chooseTransitions, chooseVerdict, countReplay, createSession, dealLabels, goTo, leaveSession,
  loadSession, nextOpen, outcomeOf, playedWords, recordFailure, recordPlayed, resultsJson, resultsText, RESULTS_SCHEMA, saveSession,
  seeded, sessionKey, setNote, shuffled, tally, toggleReason, type MixSong, type Session, type StorageLike,
} from './session';

const song = (id: number): MixSong => ({ song_id: id, title: `Song ${id}`, artist: `Artist ${id}`, duration: 200 });
const mixOf = (count: number) => Array.from({ length: count }, (_, index) => song(index + 1));
const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
};
const made = (count = 4, seed = 42): Session => createSession({ workspaceId: 'w1', mixId: 'm1', mixName: 'Friday', mix: mixOf(count), playable: () => true, seed, now: 1000, flags: { 'cloud.seam_lead': true } })!;

describe('the seeded deal', () => {
  it('gives the same numbers, the same shuffle and the same labels for the same seed', () => {
    const one = seeded(7);
    const two = seeded(7);
    expect([one(), one(), one()]).toEqual([two(), two(), two()]);
    expect(shuffled([1, 2, 3, 4, 5, 6], seeded(99))).toEqual(shuffled([1, 2, 3, 4, 5, 6], seeded(99)));
    const pairs = Array.from({ length: 8 }, () => ['before', 'after'] as const);
    expect(dealLabels(1234, pairs)).toEqual(dealLabels(1234, pairs));
  });

  it('keeps every item, deals both ways across trials and differs across seeds', () => {
    expect(shuffled([1, 2, 3, 4, 5], seeded(3)).sort()).toEqual([1, 2, 3, 4, 5]);
    const pairs = Array.from({ length: 40 }, () => ['before', 'after'] as const);
    const dealt = dealLabels(5, pairs).map((labels) => labels.A);
    expect(new Set(dealt)).toEqual(new Set(['before', 'after']));
    for (const labels of dealLabels(5, pairs)) expect([labels.A, labels.B].sort()).toEqual(['after', 'before']);
    expect(dealLabels(5, pairs)).not.toEqual(dealLabels(6, pairs));
  });

  it('stores the seed and the deal in the session, so a reload deals nothing new', () => {
    const session = made(6, 77);
    expect(session.seed).toBe(77);
    expect(session.trials.map((trial) => trial.labels)).toEqual(dealLabels(77, session.trials.map(() => ['before', 'after'] as const)));
    expect(made(6, 77).trials.map((trial) => trial.labels)).toEqual(session.trials.map((trial) => trial.labels));
  });
});

describe('choosing the transitions', () => {
  it('takes adjacent pairs whose two songs both play here', () => {
    const mix = mixOf(6);
    expect(chooseTransitions(mix, (id) => id !== 3)).toEqual([0, 3, 4]);
    expect(chooseTransitions(mix, () => true)).toEqual([0, 1, 2, 3, 4]);
    expect(chooseTransitions(mix, (id) => id === 1)).toEqual([]);
    expect(chooseTransitions(mixOf(1), () => true)).toEqual([]);
  });

  it('takes at most eight, spread across the mix from the first to the last', () => {
    const chosen = chooseTransitions(mixOf(30), () => true);
    expect(chosen).toHaveLength(8);
    expect(chosen[0]).toBe(0);
    expect(chosen[7]).toBe(28);
    expect(new Set(chosen).size).toBe(8);
    for (let index = 1; index < chosen.length; index += 1) expect(chosen[index] - chosen[index - 1]).toBeGreaterThanOrEqual(3);
  });

  it('makes no session when nothing plays, and names each trial by its two songs', () => {
    expect(createSession({ workspaceId: 'w', mixId: null, mixName: '', mix: mixOf(3), playable: () => false })).toBeNull();
    const session = made(3);
    expect(session.trials.map((trial) => [trial.from.songId, trial.to.songId])).toEqual([[1, 2], [2, 3]]);
    expect(session.trials[0].variants).toEqual([BEFORE, AFTER]);
    expect(session.trials[0].from).toMatchObject({ title: 'Song 1', artist: 'Artist 1', position: 0 });
  });
});

describe('verdicts', () => {
  it('chooses, changes and clears a verdict with one tap each', () => {
    let session = made();
    const id = session.trials[0].id;
    session = chooseVerdict(session, id, 'a_better', 5);
    expect(answerOf(session, id)).toMatchObject({ verdict: 'a_better', answeredAt: 5 });
    session = chooseVerdict(session, id, 'same', 6);
    expect(answerOf(session, id).verdict).toBe('same');
    session = chooseVerdict(session, id, 'same', 7);
    expect(answerOf(session, id).verdict).toBeNull();
  });

  it('offers only Can’t judge for a trial that failed, and drops any other verdict it had', () => {
    let session = made();
    const id = session.trials[0].id;
    session = chooseVerdict(session, id, 'b_better');
    session = recordFailure(session, id, 'a song is not on this device');
    expect(answerOf(session, id).verdict).toBeNull();
    expect(allowedVerdicts(answerOf(session, id))).toEqual(['cant_judge']);
    expect(chooseVerdict(session, id, 'a_better')).toBe(session);
    session = chooseVerdict(session, id, 'cant_judge');
    expect(answerOf(session, id).verdict).toBe('cant_judge');
  });

  it('never counts Can’t judge, a failed trial or no difference as a vote', () => {
    let session = made(5, 11);
    const [one, two, three, four] = session.trials;
    session = chooseVerdict(session, one.id, 'a_better');
    session = chooseVerdict(session, two.id, 'cant_judge');
    session = chooseVerdict(session, three.id, 'same');
    session = recordFailure(session, four.id, 'it could not be prepared');
    session = chooseVerdict(session, four.id, 'cant_judge');
    const counted = tally(session);
    expect(counted.votes).toBe(1);
    expect(counted.wins[one.labels.A]).toBe(1);
    expect(counted.wins[one.labels.B]).toBe(0);
    expect(counted).toMatchObject({ same: 1, bothBad: 0, cantJudge: 2, open: 0 });
    expect(outcomeOf(two, answerOf(session, two.id))).toEqual({ kind: 'cant_judge' });
  });

  it('resolves A and B to the variant each one was', () => {
    let session = made(4, 8);
    for (const trial of session.trials) session = chooseVerdict(session, trial.id, 'b_better');
    const counted = tally(session);
    const expected = { before: 0, after: 0 } as Record<string, number>;
    for (const trial of session.trials) expected[trial.labels.B] += 1;
    expect(counted.wins).toEqual(expected);
  });

  it('keeps reasons in their listed order, clips the note and counts replays per version', () => {
    let session = made();
    const id = session.trials[0].id;
    session = toggleReason(session, id, 'clash');
    session = toggleReason(session, id, 'beats_off');
    expect(answerOf(session, id).reasons).toEqual(['beats_off', 'clash']);
    session = toggleReason(session, id, 'clash');
    expect(answerOf(session, id).reasons).toEqual(['beats_off']);
    session = setNote(session, id, 'x'.repeat(400));
    expect(answerOf(session, id).note).toHaveLength(280);
    session = countReplay(countReplay(countReplay(session, id, 'A'), id, 'A'), id, 'B');
    expect(answerOf(session, id).replays).toEqual({ A: 2, B: 1 });
  });
});

describe('moving through the session', () => {
  it('finds the next unanswered trial, wrapping round, and the reveal when all are answered', () => {
    let session = made(4);
    const ids = session.trials.map((trial) => trial.id);
    session = chooseVerdict(session, ids[1], 'same');
    expect(nextOpen(session, 0)).toBe(2);
    session = chooseVerdict(chooseVerdict(session, ids[2], 'same'), ids[3], 'same');
    expect(nextOpen(session, 3)).toBe(0);
    session = chooseVerdict(session, ids[0], 'same');
    expect(nextOpen(session, 0)).toBe(session.trials.length);
  });

  it('finishes when it reaches the reveal and never goes past it', () => {
    const session = goTo(made(3), 99, 500);
    expect(session.position).toBe(2);
    expect(session.finishedAt).toBe(500);
    expect(goTo(session, -4).position).toBe(0);
  });
});

describe('saving and resuming in this browser', () => {
  it('resumes the session where it stopped, with its answers, keyed by workspace and session', () => {
    const storage = memory();
    let session = made(4);
    session = chooseVerdict(session, session.trials[0].id, 'a_better');
    session = countReplay(session, session.trials[0].id, 'B');
    session = goTo(session, 2);
    expect(saveSession(storage, session)).toBe(true);
    expect(storage.data.has(sessionKey('w1', session.id))).toBe(true);
    const back = loadSession(storage, 'w1')!;
    expect(back.position).toBe(2);
    expect(answerOf(back, session.trials[0].id)).toMatchObject({ verdict: 'a_better', replays: { A: 0, B: 1 } });
    expect(back.trials.map((trial) => trial.labels)).toEqual(session.trials.map((trial) => trial.labels));
    expect(loadSession(storage, 'another workspace')).toBeNull();
  });

  it('ignores anything it cannot read, and forgets the current session when asked', () => {
    const storage = memory();
    storage.setItem('selecta.listeningRoom.w1.current', 'bad');
    storage.setItem(sessionKey('w1', 'bad'), '{not json');
    expect(loadSession(storage, 'w1')).toBeNull();
    storage.setItem(sessionKey('w1', 'bad'), JSON.stringify({ schema: 99 }));
    expect(loadSession(storage, 'w1')).toBeNull();
    const session = made();
    saveSession(storage, session);
    leaveSession(storage, 'w1');
    expect(loadSession(storage, 'w1')).toBeNull();
    expect(storage.data.has(sessionKey('w1', session.id))).toBe(true);
    expect(loadSession(null, 'w1')).toBeNull();
  });

  it('fills in answer fields an older save did not have', () => {
    const storage = memory();
    const session = made(3);
    const id = session.trials[0].id;
    saveSession(storage, { ...session, answers: { [id]: { verdict: 'same' } as never } });
    const back = loadSession(storage, 'w1')!;
    expect(answerOf(back, id)).toMatchObject({ verdict: 'same', reasons: [], replays: { A: 0, B: 0 }, failed: null });
    expect(answerOf(back, session.trials[1].id).verdict).toBeNull();
  });
});

describe('the reveal and the export', () => {
  const answered = () => {
    let session = made(4, 21);
    const [one, two] = session.trials;
    session = chooseVerdict(session, one.id, 'a_better', 2000);
    session = toggleReason(session, one.id, 'level_jump');
    session = setNote(session, one.id, 'smoother');
    session = countReplay(session, one.id, 'A');
    session = recordPlayed(session, one.id, 'A', { kind: 'seam_schedule', seamKind: 'beatmatch', style: 'blend', bars: 16, windowSeconds: 30, levels: { from: 0.5, to: 1 }, at: 3 });
    session = recordPlayed(session, one.id, 'B', { kind: 'fallback_fade', reason: 'the seam was prepared too late to start on time', at: 4 });
    session = recordFailure(session, two.id, 'a song is not on this device');
    session = chooseVerdict(session, two.id, 'cant_judge');
    return goTo(session, 3, 5000);
  };

  it('says what played in plain words', () => {
    expect(playedWords({ kind: 'seam_schedule', seamKind: 'beatmatch', style: 'blend', bars: 16, at: 0 })).toBe('Blend over 16 bars, both in time');
    expect(playedWords({ kind: 'fallback_fade', reason: 'the seam was prepared too late to start on time', at: 0 })).toBe('A 3 second fade: the transition was ready too late');
    expect(playedWords({ kind: 'late_fade', at: 0 })).toMatch(/ready too late/);
    expect(playedWords({ kind: 'not_reached', at: 0 })).toBe('The transition was not reached');
    expect(playedWords(undefined)).toBe('Not played');
  });

  it('exports a versioned document with the seed, flags, timestamps, deal, verdicts and replays', () => {
    const session = answered();
    const json = resultsJson(session, { build: 'index-abc', exportedAt: 6000 });
    expect(json).toMatchObject({
      schema: RESULTS_SCHEMA,
      sessionSchema: 1,
      build: 'index-abc',
      exportedAt: new Date(6000).toISOString(),
      session: { id: session.id, seed: 21, mixName: 'Friday', flags: { 'cloud.seam_lead': true }, finishedAt: new Date(5000).toISOString() },
    });
    const [one, two] = json.trials;
    expect(one).toMatchObject({ number: 1, verdict: 'a_better', winner: session.trials[0].labels.A, reasons: ['level_jump'], note: 'smoother', replays: { A: 1, B: 0 } });
    expect(one.labels).toEqual(session.trials[0].labels);
    expect(one.played.A).toMatchObject({ kind: 'seam_schedule', words: 'Blend over 16 bars, both in time', levels: { from: 0.5, to: 1 } });
    expect(two).toMatchObject({ verdict: 'cant_judge', winner: null, failed: 'a song is not on this device' });
    expect(json.tally).toMatchObject({ cantJudge: 1, unanswered: 1, noDifference: 0 });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('writes the results as text with A and B named and the level applied', () => {
    const text = resultsText(answered(), { build: null });
    expect(text).toMatch(/^SelectaDJ Listening Room: Friday/);
    expect(text).toMatch(/1\. Song 1 into Song 2/);
    expect(text).toMatch(/A was (Before|After), B was (Before|After)\. A is better\./);
    expect(text).toMatch(/Level: first song -6\.0 dB, second song \+0\.0 dB/);
    expect(text).toMatch(/Could not play: a song is not on this device/);
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('reading what the engine played', () => {
  const record = { fromIndex: 0, toIndex: 1, sources: { a: 'device' as const, b: 'device' as const }, schedule: { implementation: 'x', kind: 'beatmatch' as const, startSeconds: 150, windowSeconds: 32, events: [], style: 'bass_swap', bars: 16 } };

  it('takes the style, bars and window from the seam record when the schedule played', () => {
    const played = playedFrom({ kind: 'seam_schedule', implementation: 'x', seamKind: 'beatmatch' }, record, { levels: { from: 1.2, to: 0.8 } }, 9);
    expect(played).toMatchObject({ kind: 'seam_schedule', seamKind: 'beatmatch', style: 'bass_swap', bars: 16, windowSeconds: 32, startSeconds: 150, stretched: false, levels: { from: 1.2, to: 0.8 }, at: 9 });
    expect(playedWords(played)).toBe('Bass swap over 16 bars, both in time');
  });

  it('places the transition on the first song: the schedule, the end fade or the boundary', () => {
    expect(scheduledSpan({ kind: 'seam_schedule', implementation: 'x' }, record, 200)).toEqual({ start: 150, window: 32 });
    expect(scheduledSpan({ kind: 'fallback_fade', implementation: 'x' }, record, 200)).toEqual({ start: 197, window: 3 });
    expect(scheduledSpan({ kind: 'boundary', implementation: 'x' }, null, 200)).toEqual({ start: 200, window: 0 });
    expect(scheduledSpan(null, null, 200)).toBeNull();
    expect(playedFrom(null, null).kind).toBe('not_reached');
  });
});
