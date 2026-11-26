import { releaseAudio, takeAudio } from '../audio/focus';
import { accountSeamPlanner, type AccountSeamAnswer, type AccountSeamAsk } from '../cloud/accountSeams';
import { browserMovesAllowed, browserMovesOn } from '../cloud/browserMoves';
import type { DeviceStudio } from '../cloud/deviceStudio';
import { makeDeviceStudio, planningAccess } from '../cloud/studioWiring';
import { mediaDeviceId } from '../cloud/ConnectMusic';
import { recallCalibration, rememberCalibration } from '../cloud/localFirstPlayer';
import * as provider from '../dsp/seamProvider';
import type { SeamRecord, SeamSettingsLike, WorkerSeamProvider } from '../dsp/seamProvider';
import type { SeamSchedule } from '../dsp/seams';
import { createEngine, type BrowserSpeaker, type Engine, type EngineContext } from '../engine';
import { createLevels, type Levels } from '../engine/level';
import { FIRST_LEVEL_WAIT_MS, LOAD_NEXT_WITHIN, type SeamRequest, type Transition } from '../engine/scheduler';
import type { MediaResolver } from '../media';
import type { Chooser, Label, LiveVariant, Played, Variant } from './session';

/** Playing one Listening Room audition on this device's own engine (tools.listening_room).
 *
 * The room owns its engine, speaker and seam providers, built as cloud/localFirstPlayer.ts's
 * startBrowserEngine builds the shell's, but with cloud.seam_lead's three options decided per
 * audition by the variant instead of by the flag. It never takes the device lease and never tells
 * the server anything: auditions are not playback of the mix.
 *
 * A trial is prepared once: both songs are decoded here, each song's level is measured, and the
 * patient seam provider is asked for the transition, which says where it starts on the first song
 * (`startSeconds`). Every audition then starts the first song LEAD_SECONDS before that and stops
 * TAIL_SECONDS after the transition has finished.
 *
 * Starting a few seconds before the transition must not change what each variant would really
 * have had time to do, so each variant gets its plan the way it would have in a whole mix:
 * - After (planAhead): the plan is made as the song starts, minutes ahead, so the plan made while
 *   preparing is the one it plays.
 * - Before: the plan is made when LOAD_NEXT_WITHIN (45 s) are left. When the audition starts later
 *   than that moment, the old player would already have planned, so the plan made while preparing
 *   (with the impatient provider) is used. When it starts earlier, the scheduler asks the
 *   impatient provider live at 45 s left, exactly as the old player did, so a transition that
 *   starts more than 45 s before the end really is prepared too late and falls back to a fade.
 * - A variant that names who chooses (session.ts Chooser) is planned by that chooser when the
 *   trial is prepared: this device, the account's planner played live, or the planner's choice
 *   made ahead on this device (cloud.device_render). Each audition starts LEAD_SECONDS before its
 *   own variant's transition, and every one plays the songs at the same measured levels.
 */

export const LEAD_SECONDS = 15;
export const TAIL_SECONDS = 12;
export const SWITCH_FADE_MS = 250;
export const STOP_FADE_MS = 600;
export const LEVEL_CHECK_SECONDS = 8;
export const FOLLOW_MS = 100;
/** An audition that has not reached its transition this long after it should have is stopped. */
const OVERRUN_SECONDS = 20;
const PREPARED_KEPT = 3;
const DECODED_KEPT = 4;
const OWNER = 'listening-room';

export type PairSong = { songId: number; title: string };
export type Pair = { from: PairSong; to: PairSong; settings: SeamSettingsLike | null };

export type Progress = {
  phase: 'loading' | 'playing' | 'paused';
  label: Label | 'check';
  /** Seconds since the audition's start, on the music's own clock. */
  elapsed: number;
  total: number;
  /** Where the transition begins, in the same seconds. */
  mark: number;
  /** False while the mark is still the prepared estimate rather than what was scheduled. */
  markKnown: boolean;
};

export type AuditionEnd = { played: Played; interrupted: boolean; problem: string | null };

type Plan = { schedule: SeamSchedule; record: SeamRecord | null };
type Prepared = { startSeconds: number; fromDuration: number; toDuration: number; after: Plan; before: Plan | null; byChooser: Partial<Record<Chooser, Plan>> };

type Token = {
  variant: LiveVariant | null;
  pair: Pair;
  prepared: Prepared | null;
  offset: number;
  record: SeamRecord | null;
  planned: boolean;
  levels: { from?: number; to?: number };
  levelLate: boolean;
  levelCalls: number;
};

/** What really played, from the engine's own account of the transition and the seam record. */
export function playedFrom(transition: Transition | null, record: SeamRecord | null, extra: { levels?: Played['levels']; levelLate?: boolean } = {}, at = Date.now()): Played {
  if (!transition) return { kind: 'not_reached', at, ...extra };
  const schedule = transition.kind === 'seam_schedule' ? record?.schedule : undefined;
  // the clip made ahead really played only when the engine names its implementation
  const studio = schedule?.rendered && schedule.studio && transition.implementation === schedule.rendered.implementation ? schedule.studio : null;
  return {
    ...(studio ? { madeAhead: { move: studio.move, passed: studio.passed, nearMiss: studio.nearMiss, fellBack: studio.fellBack } } : {}),
    kind: transition.kind,
    seamKind: transition.seamKind,
    style: schedule?.style,
    bars: schedule?.bars,
    windowSeconds: schedule?.windowSeconds,
    startSeconds: schedule?.startSeconds,
    stretched: schedule ? !!schedule.stretch : undefined,
    reason: transition.reason,
    at,
    ...extra,
  };
}

/** Where the transition begins and how long it lasts on the first song's timeline, from what was
 * scheduled; null while nothing is. */
export function scheduledSpan(transition: Transition | null, record: SeamRecord | null, fromDuration: number): { start: number; window: number } | null {
  if (!transition) return null;
  switch (transition.kind) {
    case 'seam_schedule': return record ? { start: record.schedule.startSeconds, window: record.schedule.windowSeconds } : null;
    case 'fallback_fade': return { start: Math.max(0, fromDuration - 3), window: 3 };
    case 'boundary': return { start: fromDuration, window: 0 };
    default: return null;
  }
}

export type AuditionRoom = {
  /** Open the sound from inside a press; a sentence when this device cannot. */
  open(): Promise<string | null>;
  /** Decode both songs, measure their levels and plan the transition once. */
  prepare(pair: Pair, variants?: readonly Variant[]): Promise<{ startSeconds: number }>;
  /** `variants`: the trial's, so its preparation is the one shared with the other label. */
  play(pair: Pair, variant: LiveVariant, label: Label, onProgress: (progress: Progress) => void, variants?: readonly Variant[]): Promise<AuditionEnd>;
  levelCheck(song: PairSong, onProgress: (progress: Progress) => void): Promise<AuditionEnd>;
  /** Pause or carry on; true when it is now playing. */
  togglePause(): boolean;
  stop(): void;
  setVolume(volume: number): void;
  dispose(): void;
};

const words = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem || 'unknown reason'));
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const levelKey = (buffer: AudioBuffer) => `${buffer.length}/${buffer.sampleRate}/${buffer.numberOfChannels}`;

export function createAuditionRoom({ workspaceId, resolve }: { workspaceId: string; resolve: MediaResolver }): AuditionRoom {
  let engine: Engine | null = null;
  let audio: EngineContext | null = null;
  let speaker: BrowserSpeaker | null = null;
  let opening: Promise<string | null> | null = null;
  let patient: WorkerSeamProvider | null = null;
  let hasty: WorkerSeamProvider | null = null;
  let levels: Levels | null = null;
  let disposed = false;
  let volume = 1;
  let settingsNow: SeamSettingsLike | null = null;
  let lastRecord: SeamRecord | null = null;
  // the pair being planned, for the account planner's song lookup
  let pairNow: Pair | null = null;
  let planners: Partial<Record<Chooser, WorkerSeamProvider>> = {};
  let studio: DeviceStudio | null = null;
  let active: Token | null = null;
  let finish: ((interrupted: boolean, problem?: string | null) => void) | null = null;
  const decoded = new Map<number, Promise<AudioBuffer>>();
  const prepared = new Map<string, Promise<Prepared>>();
  const measured = new Map<string, Promise<number>>();
  const pairKey = (pair: Pair) => `${pair.from.songId}>${pair.to.songId}`;

  const levelOf = (buffer: AudioBuffer): Promise<number> => {
    const key = levelKey(buffer);
    let found = measured.get(key);
    if (!found) {
      found = (levels ??= createLevels()).of(buffer);
      measured.set(key, found);
    }
    return found;
  };

  const decode = (songId: number): Promise<AudioBuffer> => {
    let found = decoded.get(songId);
    if (!found) {
      found = (async () => {
        const track = await resolve(songId);
        if (!track) throw new Error('A song in this transition is not on this device right now');
        if (!audio) throw new Error('The sound is not open yet');
        return audio.context.decodeAudioData(await track.data());
      })();
      decoded.set(songId, found);
      found.catch(() => decoded.delete(songId));
      while (decoded.size > DECODED_KEPT) decoded.delete(decoded.keys().next().value as number);
    }
    return found;
  };

  /** The account's planner for the pair being planned, made ahead on this device or not. */
  const plannerHook = (madeAhead: boolean): ((ask: AccountSeamAsk) => Promise<AccountSeamAnswer>) | undefined => {
    const request = planningAccess(workspaceId);
    if (!request) return undefined;
    const songAt = (index: number) => (index === 0 ? pairNow?.from.songId : index === 1 ? pairNow?.to.songId : undefined) ?? null;
    if (madeAhead) {
      studio ??= makeDeviceStudio({
        request, workspaceId, level: (buffer) => levelOf(buffer),
        decodedAt: async (index) => { const id = songAt(index); return id === null ? null : decode(id).catch(() => null); },
      });
    }
    return accountSeamPlanner({
      request, workspaceId, fileOf: songAt,
      shaOf: async (songId) => (await resolve(songId).catch(() => null))?.held?.sha ?? null,
      studio: madeAhead ? studio : null,
    });
  };

  const makeProvider = (calm: boolean, deviceId: string, calibration: ReturnType<typeof recallCalibration>, roster: () => ReturnType<Engine['roster']>, planned?: ReturnType<typeof plannerHook>) => provider.makeWorkerSeamProvider({
    planned,
    settingsFor: () => settingsNow,
    sourceOf: () => 'device',
    allowed: () => (browserMovesOn() ? browserMovesAllowed() : undefined),
    calibration,
    deviceId,
    patient: () => calm,
    abilities: () => provider.abilitiesFrom((feature) => roster().get(feature)),
    sourceSafe: (source) => provider.abilityOf((feature) => roster().get(feature), `seam_source_${source}`),
    onPlanned: (record) => { lastRecord = record; },
  });

  const ask = async (which: WorkerSeamProvider, request: SeamRequest, pair: Pair): Promise<Plan> => {
    const settings = pair.settings;
    settingsNow = settings;
    pairNow = pair;
    lastRecord = null;
    const schedule = await which(request);
    return { schedule, record: lastRecord };
  };

  /** The scheduler's seam provider: each variant's plan, made the way that variant would make it. */
  const seam = Object.assign(async (request: SeamRequest): Promise<SeamSchedule | null> => {
    const mine = active;
    if (!mine?.variant || !patient || !hasty) return null;
    const ready = mine.prepared;
    const chooser = mine.variant.chooser;
    const own = chooser && chooser !== 'device' ? planners[chooser] : undefined;
    const already = own
      ? ready?.byChooser[chooser!]
      : mine.variant.planAhead
        ? ready?.after
        : ready && mine.offset > ready.fromDuration - LOAD_NEXT_WITHIN ? ready.before : null;
    const plan = already ?? await ask(own ?? (mine.variant.patient ? patient : hasty), request, mine.pair);
    if (mine === active) {
      mine.record = plan.record;
      mine.planned = true;
    }
    return plan.schedule;
  }, { dispose: () => { patient?.dispose(); hasty?.dispose(); for (const one of Object.values(planners)) one?.dispose(); studio?.dispose(); } });

  const open = (): Promise<string | null> => {
    if (disposed) return Promise.resolve('The Listening Room has closed its sound.');
    if (opening) return opening;
    const made = createEngine();
    // opened here, in the press, before anything is awaited (autoplay rules)
    const opened = made.openContext({ fromUserGesture: true });
    opening = (async () => {
      if ('state' in opened) throw new Error(opened.reason);
      const probe = await made.probe(opened.context);
      if (!probe.ok) throw new Error(probe.reason);
      const deviceId = mediaDeviceId(workspaceId);
      let calibration = recallCalibration(deviceId);
      if (!calibration && typeof Worker !== 'undefined') {
        calibration = await provider.calibrateAnalysisInWorker({ deviceId });
        if (calibration) rememberCalibration(calibration);
      }
      const stretch = await made.stretchEvidence();
      const evidence = calibration ? { calibration, deviceId, atFloor: false, deadlineMisses: 0 } : null;
      // each provider keeps its own budget, so one variant's slow moment never shapes the other's
      const rosters = { calm: made.roster({ probe, workerBudget: evidence, stretch }), hasty: made.roster({ probe, workerBudget: evidence, stretch }) };
      patient = makeProvider(true, deviceId, calibration, () => rosters.calm);
      hasty = makeProvider(false, deviceId, calibration, () => rosters.hasty);
      // the planner's two ways, when this account plans from its measurements
      const liveHook = plannerHook(false);
      const madeHook = plannerHook(true);
      planners = {
        ...(liveHook ? { planner_live: makeProvider(true, deviceId, calibration, () => rosters.calm, liveHook) } : {}),
        ...(madeHook ? { planner_made: makeProvider(true, deviceId, calibration, () => rosters.calm, madeHook) } : {}),
      };
      audio = opened;
      engine = made;
      speaker = made.createSpeaker({
        audio: opened,
        probe,
        resolve: async (index) => {
          const pair = active?.pair;
          const songId = index === 0 ? pair?.from.songId : index === 1 ? pair?.to.songId : undefined;
          if (songId === undefined || songId < 0) return null;
          return resolve(songId);
        },
        queueLength: () => ((active?.pair.to.songId ?? -1) < 0 ? 1 : 2),
        seam,
        planAhead: () => active?.variant?.planAhead === true,
        level: (buffer) => {
          const mine = active;
          if (!mine?.variant?.levels) return Promise.resolve(1);
          const call = mine.levelCalls;
          mine.levelCalls += 1;
          const began = Date.now();
          return levelOf(buffer).then((gain) => {
            if (call === 0) {
              mine.levels.from = gain;
              if (Date.now() - began > FIRST_LEVEL_WAIT_MS) mine.levelLate = true;
            } else mine.levels.to = gain;
            return gain;
          });
        },
      });
      speaker.setVolume(volume);
      return null;
    })().catch((problem) => {
      made.dispose();
      opening = null;
      return `SelectaDJ could not open the sound for listening: ${words(problem)}.`;
    });
    return opening;
  };

  const prepare = (pair: Pair, variants: readonly Variant[] = []): Promise<Prepared> => {
    const choosers = [...new Set(variants.flatMap((variant) => (variant.kind === 'live' && variant.chooser && variant.chooser !== 'device' ? [variant.chooser] : [])))];
    const key = `${pairKey(pair)}|${choosers.join(',')}`;
    let found = prepared.get(key);
    if (!found) {
      found = (async () => {
        const problem = await open();
        if (problem) throw new Error(problem);
        const [from, to] = await Promise.all([decode(pair.from.songId), decode(pair.to.songId)]);
        // each song's level is measured now, as a whole mix would have long before this transition
        const [fromLevel, toLevel] = await Promise.all([levelOf(from), levelOf(to)]);
        // the levels go with the request, so a transition made ahead is made at them
        const request: SeamRequest = { fromIndex: 0, from, toIndex: 1, to, fromLevel, toLevel };
        const after = await ask(patient!, request, pair);
        const startSeconds = after.schedule.startSeconds;
        const offset = Math.max(0, startSeconds - LEAD_SECONDS);
        // the old player would already have planned this one before the audition starts
        const before = offset > from.duration - LOAD_NEXT_WITHIN ? await ask(hasty!, request, pair) : null;
        const byChooser: Prepared['byChooser'] = { device: after };
        for (const chooser of choosers) {
          const own = planners[chooser];
          if (!own) throw new Error('The planner’s choice could not be asked for from this device');
          byChooser[chooser] = await ask(own, request, pair);
        }
        return { startSeconds, fromDuration: from.duration, toDuration: to.duration, after, before, byChooser };
      })();
      prepared.set(key, found);
      found.catch(() => prepared.delete(key));
      while (prepared.size > PREPARED_KEPT) prepared.delete(prepared.keys().next().value as string);
    }
    return found;
  };

  /** Stop whatever plays, with a short fade, and wait for the fade. */
  const halt = async (fadeMs: number) => {
    const had = active;
    // forgotten first, so the audition settling here leaves the fade to this stop
    active = null;
    finish?.(true);
    if (had && speaker) {
      speaker.stop(fadeMs);
      await pause(fadeMs);
    }
  };

  const run = async (pair: Pair, variant: LiveVariant | null, label: Label | 'check', ready: Prepared | null, from: number, onProgress: (progress: Progress) => void): Promise<AuditionEnd> => {
    await halt(SWITCH_FADE_MS);
    if (!speaker || disposed) return { played: playedFrom(null, null), interrupted: true, problem: 'The sound is not open.' };
    const mine: Token = { variant, pair, prepared: ready, offset: from, record: null, planned: false, levels: {}, levelLate: false, levelCalls: 0 };
    active = mine;
    takeAudio({ id: OWNER, label: 'The Listening Room', stop: () => { void halt(SWITCH_FADE_MS); } });
    const check = label === 'check';
    const estimate = check ? LEVEL_CHECK_SECONDS : (ready?.startSeconds ?? from) - from;
    onProgress({ phase: 'loading', label, elapsed: 0, total: check ? LEVEL_CHECK_SECONDS : estimate + 3 + TAIL_SECONDS, mark: estimate, markKnown: false });
    return new Promise<AuditionEnd>((done) => {
      let timer = 0;
      let started = false;
      let lastOnFirst = 0;
      let handedAt: number | null = null;
      let bAtHand = 0;
      let transition: Transition | null = null;
      const settle = (interrupted: boolean, problem: string | null = null) => {
        window.clearInterval(timer);
        if (finish === settleHere) finish = null;
        if (active === mine) {
          active = null;
          speaker?.stop(STOP_FADE_MS);
        }
        releaseAudio(OWNER);
        const extra = variant?.levels ? { levels: { ...mine.levels }, levelLate: mine.levelLate } : {};
        done({ played: playedFrom(transition, mine.record, extra), interrupted, problem });
      };
      const settleHere = (interrupted: boolean, problem?: string | null) => settle(interrupted, problem ?? null);
      finish = settleHere;
      const follow = () => {
        if (active !== mine) return settle(true);
        const at = speaker?.position() ?? null;
        const phase = speaker?.state().phase;
        if (!at) {
          if (started && phase === 'idle') settle(false, check || transition ? null : (speaker?.state().notice || 'The audition stopped before the transition.'));
          else onProgress({ phase: 'loading', label, elapsed: Math.max(0, lastOnFirst), total: check ? LEVEL_CHECK_SECONDS : estimate + 3 + TAIL_SECONDS, mark: estimate, markKnown: false });
          return;
        }
        started = true;
        const seconds = at.offset_ms / 1000;
        if (mine.planned && !transition) transition = speaker?.lastTransition() ?? null;
        let elapsed: number;
        if (at.song_index === 0) {
          elapsed = seconds - from;
          lastOnFirst = elapsed;
        } else {
          if (handedAt === null) {
            handedAt = lastOnFirst;
            bAtHand = seconds;
          }
          elapsed = handedAt + (seconds - bAtHand);
        }
        if (check) {
          onProgress({ phase: at.state === 'paused' ? 'paused' : 'playing', label, elapsed, total: LEVEL_CHECK_SECONDS, mark: LEVEL_CHECK_SECONDS, markKnown: true });
          if (elapsed >= LEVEL_CHECK_SECONDS) settle(false);
          return;
        }
        const span = scheduledSpan(transition, mine.record, ready?.fromDuration ?? 0);
        const mark = span ? span.start - from : transition?.kind === 'late_fade' ? handedAt ?? elapsed : estimate;
        const window = span ? span.window : 3;
        const total = mark + window + TAIL_SECONDS;
        onProgress({ phase: at.state === 'paused' ? 'paused' : 'playing', label, elapsed, total, mark, markKnown: !!span || transition?.kind === 'late_fade' });
        if (transition && elapsed >= total) return settle(false);
        if (!transition && elapsed > estimate + OVERRUN_SECONDS + Math.max(0, (ready?.fromDuration ?? 0) - (ready?.startSeconds ?? 0))) {
          settle(false, 'The transition did not arrive, so the audition stopped.');
        }
      };
      timer = window.setInterval(follow, FOLLOW_MS);
      void speaker!.start(0, Math.round(from * 1000), true).catch((problem) => settle(false, words(problem)));
    });
  };

  return {
    open,
    async prepare(pair, variants) {
      const made = await prepare(pair, variants);
      return { startSeconds: made.startSeconds };
    },
    async play(pair, variant, label, onProgress, variants) {
      let ready: Prepared;
      try {
        ready = await prepare(pair, variants ?? [variant]);
      } catch (problem) {
        return { played: playedFrom(null, null), interrupted: false, problem: words(problem) };
      }
      // each variant starts the same lead before its own transition
      const own = variant.chooser ? ready.byChooser[variant.chooser] : undefined;
      const mine = own ? { ...ready, startSeconds: own.schedule.startSeconds } : ready;
      return run(pair, variant, label, mine, Math.max(0, mine.startSeconds - LEAD_SECONDS), onProgress);
    },
    async levelCheck(song, onProgress) {
      const problem = await open();
      if (problem) return { played: playedFrom(null, null), interrupted: false, problem };
      let length = 0;
      try {
        length = (await decode(song.songId)).duration;
      } catch (error) {
        return { played: playedFrom(null, null), interrupted: false, problem: words(error) };
      }
      const pair: Pair = { from: song, to: { songId: -1, title: '' }, settings: null };
      return run(pair, null, 'check', null, Math.max(0, Math.min(30, length / 3)), onProgress);
    },
    togglePause() {
      if (!speaker || !active) return false;
      const phase = speaker.state().phase;
      if (phase === 'playing') {
        speaker.pause();
        return false;
      }
      if (phase === 'paused') {
        speaker.resume();
        return true;
      }
      return phase === 'loading';
    },
    stop() {
      void halt(STOP_FADE_MS);
    },
    setVolume(next) {
      volume = Math.max(0, Math.min(1, next));
      speaker?.setVolume(volume);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = null;
      finish?.(true);
      speaker?.dispose();
      engine?.dispose();
      levels?.dispose();
      releaseAudio(OWNER);
      decoded.clear();
      prepared.clear();
    },
  };
}
