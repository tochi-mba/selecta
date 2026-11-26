import { describe, expect, it } from 'vitest';
import {
  AFTER, BEFORE, chooseVerdict, comparisonWords, createSession, DEVICE_CHOICE, isSession, MADE_AHEAD_PAIRS, MAX_TRIALS, playedWords,
  PLANNER_LIVE, PLANNER_MADE, recordPlayed, resultsText, sessionVariants, tally, type MixSong,
} from './session';

// The Listening Room's three-way comparison (cloud.device_render): the planner's choice made ahead
// against this device's own choice and against the planner's choice played live, as pairs of blind
// trials in the room's own two-variant model.

const mix: MixSong[] = Array.from({ length: 12 }, (_, index) => ({ song_id: 100 + index, title: `Song ${index + 1}`, artist: 'Artist', duration: 200 }));
const made = () => createSession({ workspaceId: 'ws', mixId: null, mixName: 'Mix', mix, playable: () => true, seed: 7, now: 1, pairs: MADE_AHEAD_PAIRS })!;

describe('comparing the planner made ahead with the other two ways', () => {
  it('hears each transition twice, made ahead against each of the other two, within the trial limit', () => {
    const session = made();
    expect(session.trials.length).toBe(MAX_TRIALS);
    for (let index = 0; index < session.trials.length; index += 2) {
      const [first, second] = [session.trials[index], session.trials[index + 1]];
      expect(first.from.songId).toBe(second.from.songId);
      expect(first.variants.map((variant) => variant.id)).toEqual([PLANNER_MADE.id, DEVICE_CHOICE.id]);
      expect(second.variants.map((variant) => variant.id)).toEqual([PLANNER_MADE.id, PLANNER_LIVE.id]);
    }
    expect(new Set(session.trials.map((trial) => trial.id)).size).toBe(session.trials.length);
    expect(isSession(JSON.parse(JSON.stringify(session)))).toBe(true);
  });

  it('plays all three at one level, planned early and patiently, so only the choice differs', () => {
    for (const variant of [DEVICE_CHOICE, PLANNER_LIVE, PLANNER_MADE]) expect(variant).toMatchObject({ kind: 'live', planAhead: true, levels: true, patient: true });
    expect(new Set([DEVICE_CHOICE, PLANNER_LIVE, PLANNER_MADE].map((variant) => variant.chooser)).size).toBe(3);
  });

  it('deals A and B blind per trial from the seed, the same every time', () => {
    expect(made().trials.map((trial) => trial.labels)).toEqual(made().trials.map((trial) => trial.labels));
    for (const trial of made().trials) {
      expect([trial.labels.A, trial.labels.B].sort()).toEqual(trial.variants.map((variant) => variant.id).sort());
    }
  });

  it('counts wins for all three ways, and names all three in the results', () => {
    let session = made();
    const [first, second] = session.trials;
    session = chooseVerdict(session, first.id, first.labels.A === PLANNER_MADE.id ? 'a_better' : 'b_better');
    session = chooseVerdict(session, second.id, second.labels.A === PLANNER_LIVE.id ? 'a_better' : 'b_better');
    const counted = tally(session);
    expect(counted.wins).toEqual({ [PLANNER_MADE.id]: 1, [DEVICE_CHOICE.id]: 0, [PLANNER_LIVE.id]: 1 });
    expect(sessionVariants(session).map((variant) => variant.id)).toEqual([PLANNER_MADE.id, DEVICE_CHOICE.id, PLANNER_LIVE.id]);
    const text = resultsText(session, { build: null });
    for (const variant of [PLANNER_MADE, DEVICE_CHOICE, PLANNER_LIVE]) expect(text).toContain(`${variant.name} won`);
  });

  it('says after the reveal the move made ahead and how its checks went, in plain words', () => {
    const base = { kind: 'seam_schedule' as const, seamKind: 'beatmatch' as const, at: 1 };
    expect(playedWords({ ...base, madeAhead: { move: 'bass_swap_blend', passed: true, nearMiss: false, fellBack: false } })).toBe('Bass swap blend, made ahead on this device: it passed every check');
    expect(playedWords({ ...base, madeAhead: { move: 'filter_sweep', passed: false, nearMiss: true, fellBack: false } })).toBe('Filter sweep, made ahead on this device: it only just missed a check');
    expect(playedWords({ ...base, madeAhead: { move: 'cut_on_one', passed: false, nearMiss: false, fellBack: true } }))
      .toBe('Cut on one, made ahead on this device: it did not pass every check, the planner’s plain cut after its other choices fell short');
    for (const words of [playedWords({ ...base, madeAhead: { move: 'bass_swap_blend', passed: true, nearMiss: false, fellBack: false } }), comparisonWords(made())]) {
      expect(words).not.toMatch(/render|audit|candidate|script|worker/i);
    }
    let session = made();
    session = recordPlayed(session, session.trials[0].id, 'A', { ...base, madeAhead: { move: 'bass_swap_blend', passed: true, nearMiss: false, fellBack: false } });
    expect(resultsText(session, { build: null })).toContain('made ahead on this device');
  });

  it('keeps the Before and After comparison exactly as it was when no pairs are asked for', () => {
    const session = createSession({ workspaceId: 'ws', mixId: null, mixName: 'Mix', mix, playable: () => true, seed: 7, now: 1 })!;
    expect(session.trials.length).toBe(MAX_TRIALS);
    expect(session.trials.every((trial) => trial.variants[0] === BEFORE && trial.variants[1] === AFTER)).toBe(true);
    expect(session.trials[0].id).toBe('t1-100-101');
    expect(comparisonWords(session)).toMatch(/^Before is the browser player as it was/);
  });
});
