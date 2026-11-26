import { makeSeam, type MadeSeam, type MakerRender, type NoSeam, type RankedOption } from '../dsp/render/seamMaker';
import { RENDER_IMPLEMENTATION } from '../dsp/render/ids';
import { optionFromJson, MAX_REPAIRS } from '../dsp/render/repair';
import { seamWorkStarted } from '../dsp/seamWork';
import { STRETCH_IMPLEMENTATION } from '../dsp/stretchLimits';
import { flagListed } from '../flags';
import { planningOn } from './accountFacts';
import type { ClipKey, ClipStore } from './clipStore';

/** Rendering transitions ahead, in play order (cloud.device_render, ADR-0479;
 * docs/engineering/device-studio-playback.md).
 *
 * While a mix plays, the studio prepares the seam out of the playing song first, then the one
 * after it: two ahead at most, one at a time, in one render worker. Each is the seam maker's loop
 * (dsp/render/seamMaker.ts) over the account planner's options for that pair, from the very
 * decoded audio the speaker will play, at the levels it plays them. A finished clip is kept in
 * memory while its seam is one of the next two, and on the device (clipStore.ts) for next time.
 *
 * When the order changes, preparation for a seam that no longer comes is dropped, its render
 * abandoned. The seam provider asks `clipFor` when it plans a seam: a clip ready in time is played;
 * anything else answers null at once or when the wait runs out, and the seam plays as it does
 * today. Nobody ever waits on a render to hear a song: the wait is spent while the outgoing song
 * plays, and it is bounded by the time left before the transition.
 */

/** Seams prepared ahead of the playing song: the next one, then the one after. */
export const SEAMS_AHEAD = 2;
/** One seam's whole loop (every take, the cut) may take at most this long. */
export const SEAM_BUDGET_MS = 120_000;

/** With the flag named on by the server, and planning from the account on. */
export const deviceRenderOn = (): boolean => flagListed('cloud.device_render') && planningOn();

/** The renderer's ids together, as a made clip names them (render/ids.ts). */
export const STUDIO_IMPLEMENTATION = `${RENDER_IMPLEMENTATION}+${STRETCH_IMPLEMENTATION}`;

type CueJson = [number, number, string, number, number];
export type OptionJson = { move: string; bars: number; exit_cue: CueJson; entry_cue: CueJson };
type Entry = { index: number; option: OptionJson; script?: unknown; has_script?: boolean };
/** `POST /api/planning/candidates`, as far as the studio reads it. */
export type CandidatesAnswer = { max_repairs?: number; fingerprint?: string; options?: Entry[]; fallback?: Entry | null };

/** A song at a mix position, playing from this device's own file. */
export type StudioSong = { songId: number; sha: string };
type Audio = AudioBuffer;
/** What `clipFor` is handed by the seam provider: the pair, decoded, and the levels it plays at. */
export type ClipAsk = { a: StudioSong; b: StudioSong; from: Audio; to: Audio; levels: { a: number; b: number } };

export type StudioDeps = {
  /** The planner's answer for a pair, with scripts; null when it cannot be had. */
  candidates(a: number, b: number): Promise<CandidatesAnswer | null>;
  /** One more option's script, by index (`candidates/script`). */
  script(a: number, b: number, index: number, fingerprint: string): Promise<unknown | null>;
  /** Whether both songs are measured here and in the account. */
  measured(a: StudioSong, b: StudioSong): Promise<boolean>;
  /** The decoded song at a mix position, the speaker's own (the same decode it plays). */
  audio(index: number): Promise<Audio | null>;
  /** The level a decoded song plays at. */
  level(audio: Audio): Promise<number>;
  render: MakerRender;
  store?: ClipStore | null;
  now?: () => number;
  /** One line per seam, in development. */
  log?: (line: string) => void;
  /** Called once when the studio is disposed (ends the render worker). */
  stop?: () => void;
};

type Job = {
  key: string;
  a: StudioSong;
  b: StudioSong;
  levels: { a: number; b: number } | null;
  controller: AbortController;
  result: Promise<MadeSeam | NoSeam>;
  done: MadeSeam | NoSeam | null;
};

const pairKey = (a: StudioSong, b: StudioSong) => `${a.sha}>${b.sha}`;
const sameLevels = (one: { a: number; b: number }, two: { a: number; b: number }) => Math.fround(one.a) === Math.fround(two.a) && Math.fround(one.b) === Math.fround(two.b);
const wait = (ms: number) => new Promise<null>((done) => setTimeout(() => done(null), Math.max(0, ms)));

/** The answer's options as the seam maker takes them, scripts as JSON text. */
export function rankedFrom(answer: CandidatesAnswer): { options: RankedOption[]; fallback: { option: ReturnType<typeof optionFromJson>; script: string | null } | null } {
  const text = (entry: Entry): string | null | undefined => {
    if (entry.has_script === false) return null;
    if (entry.script && typeof entry.script === 'object') return JSON.stringify(entry.script);
    return undefined;
  };
  const options = (answer.options ?? []).map((entry, place) => ({
    index: Number.isInteger(entry.index) ? entry.index : place,
    option: optionFromJson(entry.option as unknown as Record<string, unknown>),
    script: text(entry),
  }));
  const fallback = answer.fallback ? { option: optionFromJson(answer.fallback.option as unknown as Record<string, unknown>), script: text(answer.fallback) ?? null } : null;
  return { options, fallback };
}

export class DeviceStudio {
  private wanted: { key: string; fromIndex: number; toIndex: number; a: StudioSong; b: StudioSong }[] = [];
  private jobs = new Map<string, Job>();
  private running: Job | null = null;
  private disposed = false;
  private readonly asked = new Map<string, Promise<CandidatesAnswer | null>>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: StudioDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => undefined);
  }

  /** The planner's answer for a pair, asked once while the pair is wanted. */
  candidates(a: number, b: number): Promise<CandidatesAnswer | null> {
    const key = `${a}>${b}`;
    let found = this.asked.get(key);
    if (!found) {
      found = this.deps.candidates(a, b).catch(() => null);
      this.asked.set(key, found);
      void found.then((answer) => { if (!answer) this.asked.delete(key); });
      while (this.asked.size > 8) this.asked.delete(this.asked.keys().next().value as string);
    }
    return found;
  }

  /** The play order (a song per position, null where it is not this device's own file) and the
   * position playing. Seams that no longer come are dropped; the next ones are prepared. */
  follow(order: readonly (StudioSong | null)[], playing: number): void {
    if (this.disposed) return;
    const wanted: DeviceStudio['wanted'] = [];
    if (deviceRenderOn()) {
      for (let step = 0; step < SEAMS_AHEAD; step += 1) {
        const a = order[playing + step];
        const b = order[playing + step + 1];
        if (a && b && a.sha !== b.sha) wanted.push({ key: pairKey(a, b), fromIndex: playing + step, toIndex: playing + step + 1, a, b });
      }
    }
    this.wanted = wanted;
    const keep = new Set(wanted.map((seam) => seam.key));
    for (const [key, job] of this.jobs) {
      if (keep.has(key)) continue;
      job.controller.abort();
      this.jobs.delete(key);
    }
    this.pump();
  }

  /** A clip for this seam made from these very songs at these levels, or null: at once when there
   * is none, or once `waitMs` runs out. The seam then plays as it would without one. */
  async clipFor(ask: ClipAsk, waitMs: number): Promise<MadeSeam | NoSeam | null> {
    if (this.disposed || !deviceRenderOn()) return null;
    const key = pairKey(ask.a, ask.b);
    let job = this.jobs.get(key);
    if (job?.done?.status === 'clip' && !sameLevels(job.done.rendered.levels, ask.levels)) job = undefined;
    if (job && job.levels && !sameLevels(job.levels, ask.levels)) job = undefined;
    if (!job) {
      if (waitMs <= 0) return null;
      // the seam that plays next comes first: whatever renders further ahead gives way
      if (this.running && this.running.key !== key) this.running.controller.abort();
      job = this.start(key, ask.a, ask.b, { from: ask.from, to: ask.to, levels: ask.levels });
    }
    const outcome = job.done ?? await Promise.race([job.result, wait(waitMs)]);
    return outcome;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deps.stop?.();
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
    this.wanted = [];
  }

  /** Start the next wanted seam that has no work yet, when nothing is rendering. */
  private pump(): void {
    if (this.disposed || this.running) return;
    const next = this.wanted.find((seam) => !this.jobs.has(seam.key));
    if (!next) return;
    void this.prepare(next);
  }

  private async prepare(seam: DeviceStudio['wanted'][number]): Promise<void> {
    const [from, to] = await Promise.all([this.deps.audio(seam.fromIndex).catch(() => null), this.deps.audio(seam.toIndex).catch(() => null)]);
    // the order may have moved on while the songs were read
    if (this.disposed || this.running || this.jobs.has(seam.key) || !this.wanted.some((one) => one.key === seam.key)) return this.pump();
    if (!from || !to) {
      // noted as done, so the seam after it is prepared rather than this one asked for again
      const none: NoSeam = { status: 'none', reason: 'a song could not be read here', attempts: [], tookMs: 0, implementation: STUDIO_IMPLEMENTATION };
      this.jobs.set(seam.key, { key: seam.key, a: seam.a, b: seam.b, levels: null, controller: new AbortController(), result: Promise.resolve(none), done: none });
      return this.pump();
    }
    const levels = { a: await this.deps.level(from).catch(() => 1), b: await this.deps.level(to).catch(() => 1) };
    if (this.disposed || this.running || this.jobs.has(seam.key) || !this.wanted.some((one) => one.key === seam.key)) return this.pump();
    this.start(seam.key, seam.a, seam.b, { from, to, levels });
  }

  private start(key: string, a: StudioSong, b: StudioSong, songs: { from: Audio; to: Audio; levels: { a: number; b: number } }): Job {
    const controller = new AbortController();
    const job: Job = { key, a, b, levels: songs.levels, controller, result: Promise.resolve(null as never), done: null };
    job.result = this.make(job, songs).then((outcome) => {
      job.done = outcome;
      return outcome;
    });
    this.jobs.set(key, job);
    this.running = job;
    void job.result.finally(() => {
      if (this.running === job) this.running = null;
      // an abandoned or failed seam may be asked again later
      if (job.done?.status !== 'clip' && this.jobs.get(key) === job && controller.signal.aborted) this.jobs.delete(key);
      this.pump();
    });
    return job;
  }

  /** One seam: from the device's store when it was made before, else the seam maker's loop. */
  private async make(job: Job, songs: { from: Audio; to: Audio; levels: { a: number; b: number } }): Promise<MadeSeam | NoSeam> {
    const began = this.now();
    const none = (reason: string): NoSeam => ({ status: 'none', reason, attempts: [], tookMs: this.now() - began, implementation: STUDIO_IMPLEMENTATION });
    // background measuring holds off while a transition is in hand (seamWork.ts)
    const done = seamWorkStarted();
    try {
      if (!(await this.deps.measured(job.a, job.b))) return none('a song is not measured here and in the account');
      const answer = await this.candidates(job.a.songId, job.b.songId);
      if (job.controller.signal.aborted) return none('it was no longer wanted');
      if (!answer?.options?.length || !answer.fingerprint) return none('the planner had no transition for these songs');
      const clipKey: ClipKey = { shaA: job.a.sha, shaB: job.b.sha, fingerprint: answer.fingerprint, levels: songs.levels, implementation: STUDIO_IMPLEMENTATION };
      const stored = await this.deps.store?.get(clipKey).catch(() => null);
      if (stored) {
        this.log(`[studio] ${job.a.songId} > ${job.b.songId}: kept from before, ${stored.move}${stored.passed ? '' : ' (did not pass every check)'}`);
        return stored;
      }
      const { options, fallback } = rankedFrom(answer);
      const fingerprint = answer.fingerprint;
      const outcome = await makeSeam({
        options,
        fallback,
        maxRepairs: Number.isInteger(answer.max_repairs) ? answer.max_repairs : MAX_REPAIRS,
        a: { songId: job.a.songId, audio: songs.from, level: songs.levels.a },
        b: { songId: job.b.songId, audio: songs.to, level: songs.levels.b },
        render: this.deps.render,
        fetchScript: async (index) => {
          const script = await this.deps.script(job.a.songId, job.b.songId, index, fingerprint);
          return script && typeof script === 'object' ? JSON.stringify(script) : null;
        },
        deadline: began + SEAM_BUDGET_MS,
        now: this.now,
        signal: job.controller.signal,
      });
      this.log(outcome.status === 'clip'
        ? `[studio] ${job.a.songId} > ${job.b.songId}: ${outcome.move}${outcome.fellBack ? ' (the fallback cut)' : ''}, ${outcome.passed ? 'passed' : outcome.nearMiss ? 'near miss' : 'did not pass'}, ${outcome.attempts.length} tried, ${outcome.tookMs} ms, ${outcome.implementation}`
        : `[studio] ${job.a.songId} > ${job.b.songId}: no clip, ${outcome.reason}, ${outcome.tookMs} ms`);
      if (outcome.status === 'clip') void this.deps.store?.put(clipKey, outcome);
      return outcome;
    } catch (problem) {
      return none(problem instanceof Error ? problem.message : String(problem));
    } finally {
      done();
    }
  }
}
