import { roundHalfEven } from '../dsp/analysis/numeric';
import type { RenderedClip, SeamSchedule, TrackTiming } from '../dsp/seams';
import { flagListed } from '../flags';
import { bytesSha256 } from '../media/identity';
import type { ResolvedTrack } from '../media/resolve';
import type { Request } from './accountFacts';
import { LATE_GUARD_SECONDS, type AccountSeamAnswer, type AccountSeamAsk } from './accountSeams';
import { RENDER_WAIT_MS, renderedSchedule } from './renderedPlan';
import { planStudios, type ConnectionLike } from './studioPlan';

/** Transitions made in the cloud, played by the shared engine (cloud.studio_seams, two-places
 * plan Phase 5; docs/engineering/device-studio-playback.md, "Transitions made in the cloud").
 *
 * For each of the next two seams that studioPlan.ts gives the cloud studio, the seams route is
 * asked (`POST /api/hosted/seams`, catalogue song ids, the planned move, the interactive lane)
 * and asked again with a bounded backoff while it is queued or running. Each answer names both
 * songs' lossless files and, once each song's loudness is known, the level the clip is made at:
 * a song next to a cloud seam plays from that file at that level (`songAt`), so the clip and the
 * song are one decode at one level. Once ready, the clip is fetched, checked against its SHA-256
 * and decoded by the playing context. When the seam is planned, `planned` hands the provider the
 * clip as a rendered seam, waiting at most the device studio's render wait; anything else (not
 * ready in time, refused, the day's allowance used up, no cloud copy) is a reason, and the seam
 * plays live. Nothing from this device is sent: catalogue ids, a move and a lane, and the bytes
 * come down from signed links (cloudLibrary.egress.test.ts). */

export const cloudSeamsOn = (): boolean => flagListed('cloud.studio_seams');
/** Names a clip made by the cloud studio wherever a transition names what made it. */
export const CLOUD_CLIP_IMPLEMENTATION = 'cloud-studio-1';
/** Said in the seam info for a transition made in the cloud. */
export const CLOUD_TRANSITION_WHY = 'Prepared in your cloud library.';
/** Said in the seam info, once per transition, when the day's allowance is used up. */
export const ALLOWANCE_USED_LINE = 'Today’s prepared transitions are used up; the rest are worked out as the mix plays.';

/** Seams prepared ahead of the playing song, as the device studio's. */
export const SEAMS_AHEAD = 2;
/** Waits between asks while the cloud studio works, then the last again; and the whole bound. */
export const POLL_DELAYS_MS = [2000, 4000, 8000, 15_000, 30_000] as const;
export const POLL_FOR_MS = 15 * 60_000;
/** Failed asks in a row before giving up on a seam. */
export const ERRORS_TRIED = 4;
/** How long a song about to play waits for its seam's first answer, as a first song's level. */
export const LOSSLESS_WAIT_MS = 2500;
/** A signed link is good for 15 minutes; one older than this is asked for again. */
export const LINK_FRESH_MS = 12 * 60_000;
/** A cloud clip can start this long before its first song ends, at the most. */
const EARLIEST_CLIP_S = 75;
const MARGIN_SECONDS = 4;
/** A decoded clip may differ from its stated length by this much. */
const LENGTH_SLACK_S = 0.05;

export type Lane = 'interactive' | 'standard';
export type FileLink = { url: string; sha256: string; sample_rate: number; seconds: number };
export type ClipLink = {
  url: string; sha256: string; a_source_start: number; b_source_end: number; seconds: number; sample_rate: number;
  switch_at: number | null; b_warp: { output: number[]; source: number[] } | null;
};
type Levels = { a_gain_db: number; b_gain_db: number };
/** `POST /api/hosted/seams`, as far as the player reads it. */
export type SeamAnswer = {
  state: 'ready' | 'queued' | 'running' | 'waiting_for_analysis' | 'failed' | 'refused';
  why?: string | null; code?: string | null; move?: string | null; passed?: boolean | null; fell_back?: boolean | null;
  files?: { a: FileLink | null; b: FileLink | null } | null;
  clip?: ClipLink | null;
  levels?: Levels | null;
};
type Ready = SeamAnswer & { clip: ClipLink; levels: Levels; files: { a: FileLink; b: FileLink } };

/** One transition asked of the cloud studio: catalogue song ids and the planned move. */
export type CloudPair = { a: number; b: number; move: string | null };
export const pairKey = (pair: CloudPair): string => `${pair.a}>${pair.b}|${pair.move ?? ''}`;

/** The clip's bytes with the answer they belong to, or why there is none. */
export type Asked = { ready: Ready; bytes: ArrayBuffer } | { declined: string };
type Decoded = { length?: number; duration: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };

export type AskDeps = {
  request: Request;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  sha256?: (bytes: ArrayBuffer) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** The linear gain of a level in dB: one expression for the clip and its songs, so they match. */
export const gainOf = (db: number): number => 10 ** (db / 20);

const plainFetch = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error('SelectaDJ could not fetch this from your cloud library.'), { status: response.status });
  return response.arrayBuffer();
};
const nap = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const within = <T>(work: Promise<T>, ms: number): Promise<T | null> => Promise.race([work, nap(Math.max(0, ms)).then(() => null)]);
const statusOf = (problem: unknown) => Number((problem as { status?: unknown } | null)?.status);
const isReady = (answer: SeamAnswer): answer is Ready => answer.state === 'ready' && !!answer.clip && !!answer.levels && !!answer.files?.a && !!answer.files?.b;

/** One ask of the route; it throws as the account's API throws. */
export function askOnce(deps: AskDeps, pair: CloudPair, lane: Lane): Promise<SeamAnswer> {
  return deps.request<SeamAnswer>('/hosted/seams', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: pair.a, b: pair.b, move: pair.move, lane }),
  });
}

/** Ask for one pair until its clip is ready, refused or failed, or POLL_FOR_MS has passed.
 * `told` hears every answer, for the lossless files and levels it carries. */
export async function askPair(pair: CloudPair, lane: Lane, deps: AskDeps, signal: AbortSignal, told?: (answer: SeamAnswer) => void): Promise<Asked> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? nap;
  const began = now();
  let errors = 0;
  for (let step = 0; !signal.aborted; step += 1) {
    try {
      const answer = await askOnce(deps, pair, lane);
      errors = 0;
      if (signal.aborted) break;
      told?.(answer);
      if (isReady(answer)) {
        const bytes = await (deps.fetchBytes ?? plainFetch)(answer.clip.url);
        if (await (deps.sha256 ?? bytesSha256)(bytes) !== answer.clip.sha256) return { declined: 'the transition from your cloud library did not arrive whole' };
        return { ready: answer, bytes };
      }
      if (answer.state === 'refused') return { declined: answer.code === 'allowance_used' ? ALLOWANCE_USED_LINE : `the cloud library could not take it on: ${answer.why ?? 'it was busy'}` };
      if (answer.state === 'failed') return { declined: `the cloud library could not make it: ${answer.why ?? 'it stopped part way'}` };
    } catch (problem) {
      const status = statusOf(problem);
      if (status === 404) return { declined: 'a song is not in your cloud library' };
      if (status === 400 || status === 403) return { declined: 'the cloud library does not make this transition' };
      errors += 1;
      if (errors >= ERRORS_TRIED) return { declined: 'your cloud library could not be reached' };
    }
    const delay = POLL_DELAYS_MS[Math.min(step, POLL_DELAYS_MS.length - 1)];
    if (now() - began + delay > POLL_FOR_MS) return { declined: 'the transition from your cloud library took too long' };
    await sleep(delay);
  }
  return { declined: 'it was no longer wanted' };
}

/** The clip as the scheduler plays it, from its decode at the playing context's rate: A's start
 * and B's end are counted in samples at that rate (the songs decode at it too, whatever rate their
 * files carry). Null when the decode is not the clip the answer describes. */
export function clipFrom(audio: Decoded, ready: Ready): RenderedClip | null {
  const rate = audio.sampleRate;
  const { clip, levels } = ready;
  if (!(rate > 0) || audio.numberOfChannels < 1 || Math.abs(audio.duration - clip.seconds) > LENGTH_SLACK_S) return null;
  const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, channel) => audio.getChannelData(channel));
  const seconds = channels[0].length / rate;
  return {
    channels,
    sampleRate: rate,
    aStartSample: roundHalfEven(clip.a_source_start * rate),
    bEndSample: roundHalfEven(clip.b_source_end * rate),
    levels: { a: gainOf(levels.a_gain_db), b: gainOf(levels.b_gain_db) },
    // an older seam says neither: "now playing" moves at the clip's middle, and B runs straight
    switchAt: clip.switch_at ?? seconds / 2,
    bWarp: clip.b_warp ?? { output: [0, seconds], source: [clip.b_source_end - seconds, clip.b_source_end] },
    implementation: CLOUD_CLIP_IMPLEMENTATION,
  };
}

/** How long the provider may wait for a clip still being made: at most the render wait, and
 * never past the earliest a clip could start, less the live plan's guard. */
export function cloudWaitMs(ask: Pick<AccountSeamAsk, 'fromIndex' | 'fromSeconds'>, heard: { index: number; seconds: number } | null): number {
  const at = heard && heard.index === ask.fromIndex ? heard.seconds : 0;
  const room = ask.fromSeconds - EARLIEST_CLIP_S - at - LATE_GUARD_SECONDS - MARGIN_SECONDS;
  return Math.max(0, Math.min(RENDER_WAIT_MS, room * 1000));
}

const bare = (durationSeconds: number): TrackTiming => ({ beats: [], tempo: { bpm: 0, confidence: 0, ambiguous: true }, durationSeconds });

/** A song's lossless file as the engine loads it: its own id (the file's hash, so the decode cache
 * never mixes it up with the song's original) and the level it plays at. */
export type CloudTrack = { id: string; source: 'hosted'; level: number; data: () => Promise<ArrayBuffer> };

type Made = { audio: Decoded; ready: Ready } | { declined: string };
type Job = {
  key: string; pair: CloudPair; control: AbortController;
  latest: SeamAnswer | null; answeredAt: number;
  answered: Promise<void>; outcome: Promise<Made>; done: Made | null;
};

export type CloudSeamsDeps = AskDeps & {
  /** Decode bytes as the speaker decodes them, at its context's rate; null when it cannot. */
  decode(bytes: ArrayBuffer): Promise<Decoded | null>;
  /** Which mix position plays and how far into it, or null. */
  heard?(): { index: number; seconds: number } | null;
  /** Whether the flag is on now. */
  on?(): boolean;
};

export class CloudSeams {
  private seams: readonly (CloudPair | null)[] = [];
  private followed = false;
  private wake: () => void = () => undefined;
  private firstFollow = new Promise<void>((done) => { this.wake = done; });
  private readonly jobs = new Map<string, Job>();
  /** Each decoded song's file, so a clip plays only between the files it was made from. */
  private readonly files = new WeakMap<object, string>();
  private readonly fallen = new Set<string>();
  private disposed = false;
  private readonly now: () => number;

  constructor(private readonly deps: CloudSeamsDeps) {
    this.now = deps.now ?? Date.now;
  }

  private on(): boolean {
    return !this.disposed && (this.deps.on?.() ?? cloudSeamsOn());
  }

  /** The mix's cloud seams, by the position of the song each leaves (null where a seam is not the
   * cloud's), and the position playing: the next two are asked for, any other is dropped. */
  follow(seams: readonly (CloudPair | null)[], position: number): void {
    if (this.disposed) return;
    this.seams = [...seams];
    this.followed = true;
    this.wake();
    const wanted = new Set<string>();
    for (let step = 0; step < SEAMS_AHEAD && this.on(); step += 1) {
      const pair = seams[position + step];
      if (pair) wanted.add(pairKey(pair));
    }
    // a seam no longer among the next two (it played, or the mix was edited) is dropped
    for (const [key, job] of this.jobs) {
      if (wanted.has(key)) continue;
      job.control.abort();
      this.jobs.delete(key);
    }
    for (let step = 0; step < SEAMS_AHEAD; step += 1) this.ensure(position + step);
  }

  /** The job for the seam leaving `index`, started when it has none. */
  private ensure(index: number): Job | null {
    const pair = this.seams[index];
    if (!pair || !this.on()) return null;
    const key = pairKey(pair);
    const had = this.jobs.get(key);
    if (had) return had;
    const control = new AbortController();
    let heard = () => undefined as void;
    const job: Job = { key, pair, control, latest: null, answeredAt: 0, answered: new Promise<void>((done) => { heard = done; }), outcome: Promise.resolve({ declined: '' }), done: null };
    job.outcome = askPair(pair, 'interactive', this.deps, control.signal, (answer) => {
      job.latest = answer;
      job.answeredAt = this.now();
      heard();
    }).then(async (asked): Promise<Made> => {
      if ('declined' in asked) return asked;
      const audio = await this.deps.decode(asked.bytes).catch(() => null);
      return audio ? { audio, ready: asked.ready } : { declined: 'the transition from your cloud library could not be read here' };
    }).then((made) => {
      job.done = made;
      heard();
      return made;
    });
    this.jobs.set(key, job);
    return job;
  }

  /** The song at a mix position from its lossless file, at the level its clip is made at, or
   * null: it then plays from wherever it would have. `original` reads it the usual way, used
   * when the lossless file cannot be had after all. */
  async songAt(index: number, songId: number, original: () => Promise<ResolvedTrack | null>, waitMs = LOSSLESS_WAIT_MS): Promise<CloudTrack | null> {
    if (!this.on()) return null;
    const began = this.now();
    if (!this.followed) await within(this.firstFollow, waitMs);
    const into = this.seams[index - 1];
    const out = this.seams[index];
    const sides: { job: Job; side: 'a' | 'b' }[] = [];
    if (into && into.b === songId) {
      const job = this.jobs.get(pairKey(into));
      if (job) sides.push({ job, side: 'b' });
    }
    if (out && out.a === songId) {
      // the seam out of a song about to play is wanted anyway: a start can come before the
      // position playing is known
      const job = this.ensure(index);
      if (job) sides.push({ job, side: 'a' });
    }
    if (!sides.length) return null;
    const usable = () => sides.find(({ job, side }) => {
      const answer = job.latest;
      return answer && ['ready', 'queued', 'running'].includes(answer.state) && answer.files?.[side] && answer.levels;
    });
    if (!usable()) await within(Promise.race(sides.map(({ job }) => job.answered)), waitMs - (this.now() - began));
    if (!usable()) await within(Promise.all(sides.map(({ job }) => job.answered)), waitMs - (this.now() - began));
    const found = usable();
    return found ? this.track(found.job, found.side, original) : null;
  }

  private track(job: Job, side: 'a' | 'b', original: () => Promise<ResolvedTrack | null>): CloudTrack {
    const answer = job.latest!;
    const file = answer.files![side]!;
    const db = side === 'a' ? answer.levels!.a_gain_db : answer.levels!.b_gain_db;
    const id = `cloud:${file.sha256}`;
    const fetchBytes = this.deps.fetchBytes ?? plainFetch;
    const link = async (again: boolean): Promise<string> => {
      if (!again && this.now() - job.answeredAt < LINK_FRESH_MS) return job.latest?.files?.[side]?.url ?? file.url;
      // signed again (a long pause, a seek, a song that starts after its link ran out)
      const fresh = await askOnce(this.deps, job.pair, 'interactive');
      job.latest = fresh;
      job.answeredAt = this.now();
      return fresh.files?.[side]?.url ?? file.url;
    };
    return {
      id,
      source: 'hosted',
      level: gainOf(db),
      data: async () => {
        try {
          let bytes: ArrayBuffer;
          try {
            bytes = await fetchBytes(await link(false));
          } catch (problem) {
            if (![400, 401, 403].includes(statusOf(problem))) throw problem;
            bytes = await fetchBytes(await link(true));
          }
          if (await (this.deps.sha256 ?? bytesSha256)(bytes) !== file.sha256) throw new Error('not the file the clip was made from');
          this.fallen.delete(id);
          return bytes;
        } catch (problem) {
          // the song still plays, from its usual file, and no cloud clip plays next to it
          const usual = await original();
          if (!usual) throw problem;
          this.fallen.add(id);
          return usual.data();
        }
      },
    };
  }

  /** The engine decoded the song with this track id; told for every song it plays. */
  noteDecoded(id: number | string, audio: object): void {
    if (typeof id !== 'string' || !id.startsWith('cloud:')) return;
    if (this.fallen.has(id)) this.files.delete(audio);
    else this.files.set(audio, id.slice('cloud:'.length));
  }

  /** The seam provider's hook (dsp/seamProvider.ts `planned`): the cloud's clip for this seam as a
   * rendered seam, why there is none, or null when the seam is not the cloud's. */
  async planned(ask: AccountSeamAsk): Promise<AccountSeamAnswer> {
    if (!this.on() || ask.toIndex !== ask.fromIndex + 1) return null;
    const job = this.ensure(ask.fromIndex);
    if (!job) return null;
    const made = job.done ?? await within(job.outcome, cloudWaitMs(ask, this.deps.heard?.() ?? null));
    // a clip that comes later is dropped: this seam plays live
    if (!made) return { declined: 'the transition from your cloud library was not ready in time' };
    if ('declined' in made) return { declined: made.declined };
    const { ready, audio } = made;
    if (!ask.from || !ask.to || this.files.get(ask.from) !== ready.files.a.sha256 || this.files.get(ask.to) !== ready.files.b.sha256) {
      return { declined: 'a song is not playing from its file in your cloud library' };
    }
    const clip = clipFrom(audio, ready);
    if (!clip) return { declined: 'the transition from your cloud library is not the length it should be' };
    const heard = this.deps.heard?.() ?? null;
    if (heard && heard.index === ask.fromIndex && clip.aStartSample / clip.sampleRate - heard.seconds < LATE_GUARD_SECONDS) {
      return { declined: 'the transition from your cloud library was ready too late' };
    }
    const schedule: SeamSchedule = renderedSchedule(clip, {
      beatsAligned: true,
      move: ready.move ?? 'blend',
      why: CLOUD_TRANSITION_WHY,
      chosenBy: { by: 'cloud' },
      studio: { move: ready.move ?? 'blend', passed: ready.passed === true, nearMiss: false, fellBack: ready.fell_back === true, tookMs: 0, implementation: CLOUD_CLIP_IMPLEMENTATION, attempts: [] },
    });
    return { scripted: { a: bare(ask.fromSeconds), b: bare(ask.toSeconds), abilities: ask.abilities, allowed: ask.allowed }, schedule };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.jobs.values()) job.control.abort();
    this.jobs.clear();
    this.wake();
  }
}

/** A mix song as the plan reads it: the seam settings of the transition into it. */
export type MixSong = { song_id: number; seam?: { settings?: { move?: string | null; exit_bar?: number | null; entry_bar?: number | null } | null } | null };

/** The planned move a seam asks the cloud for: a named move, or none for SelectaDJ to choose. */
const moveOf = (song: MixSong): string | null => {
  const move = song.seam?.settings?.move;
  return move && move !== 'auto' ? move : null;
};

/** The cloud's seams of a mix by the position each leaves, null where studioPlan.ts gives a seam
 * to another studio. `ownCopies` names the songs with their own cloud copy (never a version's). */
export async function cloudPairsOf(mix: readonly MixSong[], ownCopies: (songIds: readonly number[]) => Promise<ReadonlySet<number>>, options: { device: boolean; here?: (index: number) => boolean; connection?: ConnectionLike }): Promise<(CloudPair | null)[]> {
  const copies = await ownCopies(mix.map((song) => song.song_id)).catch(() => new Set<number>());
  const plan = planStudios(mix.map((song, index) => ({
    songId: song.song_id,
    cloud: copies.has(song.song_id),
    here: options.here?.(index) ?? false,
    cued: song.seam?.settings?.exit_bar != null || song.seam?.settings?.entry_bar != null,
  })), { cloud: true, device: options.device, connection: options.connection });
  return plan.seams.map((studio, index) => (studio === 'cloud' ? { a: mix[index].song_id, b: mix[index + 1].song_id, move: moveOf(mix[index + 1]) } : null));
}

type Planner = (ask: AccountSeamAsk) => Promise<AccountSeamAnswer>;

/** The cloud studio first for its own seams, then the account's planner as before. When the cloud
 * gave no clip, its reason goes on the record (the day's allowance line shows in the seam info). */
export function withCloudSeams(cloud: CloudSeams, other: Planner): Planner {
  return async (ask) => {
    const mine = await cloud.planned(ask).catch(() => null);
    if (mine && 'schedule' in mine) return mine;
    const theirs = await other(ask);
    if (!mine) return theirs;
    if (theirs && 'schedule' in theirs) return { ...theirs, schedule: { ...theirs.schedule, chosenBy: { by: theirs.schedule.chosenBy?.by ?? 'account', note: mine.declined } } };
    return mine;
  };
}
