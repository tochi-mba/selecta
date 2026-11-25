import { fileKey, PartReader, type ReadBytes } from './partReader';

/** Gapless playback of a server-rendered timeline (cloud.hosted_render).
 *
 * The server cuts each song at its rendered seam's cue points and hands over the seam clips
 * between them (hosted_render.py on the server): every part is a lossless file and a stretch of it
 * (`from_s`, `seconds`). The player reads each part a few seconds at a time (partReader.ts), decodes
 * that window, and schedules it straight after the one before on one AudioContext clock, counted
 * in whole sample frames, so every join is sample-exact: no browser mixing, no crossfade of its own.
 *
 * What it holds is bounded: about `AHEAD_S` of decoded audio is scheduled ahead and each window is
 * let go once it has played. It used to fetch and decode whole files (34 to 64 MB each, 60 to 90 MB
 * decoded) and keep up to three, and a slow decode let every 250 ms tick schedule the same part
 * again (docs/engineering/hosted-mode-walkthrough.md, section 7).
 *
 * Signed links live 15 minutes: the player asks the server for fresh ones (`refresh`) when its
 * links are older than `LINK_LIFE_MS` or a read is refused, so a long mix never dies part way.
 */

export type TimelinePart = {
  kind: 'song' | 'seam';
  from_s: number;
  seconds: number;
  url: string | null;
  name?: string | null;
  asset_id?: string;
  move?: string | null;
  index?: number;
  /** A song part plays at its mix level (the level the seam clips were rendered at). */
  gain_db?: number;
};

export type PlayerState = {
  playing: boolean;
  /** The part playing now, and how far into it (seconds). */
  part: number;
  at: number;
  /** Seconds into the whole mix, and its length. */
  elapsed: number;
  total: number;
  /** Nothing is playing yet, or the next window hasn't arrived in time. */
  waiting: boolean;
  error: string | null;
};

/** A read the storage refused because the signed link ran out (or never was valid). */
export class LinkExpired extends Error {}

/** The browser could not decode a window (or took far too long): trying again would not help. */
export class CannotDecode extends Error {}
export const CANNOT_DECODE = 'this browser could not play the mix’s lossless audio. Try it in another browser, or export the mix and play the download.';
/** A window is a few seconds of audio; a decode that takes this long is not going to finish. */
const DECODE_LIMIT_MS = 20000;

type Context = BaseAudioContext & { close?: () => Promise<void>; resume?: () => Promise<void>; suspend?: () => Promise<void> };
type Scheduled = { source: AudioBufferSourceNode; level: GainNode; when: number; end: number; part: number; partAt: number; samples: number };

export type PlayerDeps = {
  context?: () => Context;
  /** Bytes `start` to `end` (exclusive) of a signed link; fewer at the end of the file. `signal`
   * aborts it when the player stops or jumps elsewhere. */
  readUrl?: (url: string, start: number, end: number, signal?: AbortSignal) => Promise<Uint8Array>;
  every?: (ms: number, run: () => void) => () => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  aheadS?: number;
};

export const AHEAD_S = 15;
const LEAD_S = 0.2;
const TICK_MS = 500;
export const LINK_LIFE_MS = 10 * 60 * 1000;
const TRIES = 4;
/** The engine's rate (worker SAMPLE_RATE): the context runs at it, so nothing is resampled. */
const RATE = 44100;

/** Set when the store's CORS rules refused a ranged read: from then on whole-body reads, cut here. */
let rangesRefused = false;

async function readSignedUrl(url: string, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  let answer: Response;
  try {
    answer = await fetch(url, rangesRefused ? { cache: 'no-store', signal } : { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store', signal });
  } catch (problem) {
    if (rangesRefused || !(problem instanceof TypeError) || signal?.aborted) throw problem;
    rangesRefused = true; // a refused preflight looks like a network error; try once without
    answer = await fetch(url, { cache: 'no-store', signal });
  }
  if (answer.status === 403 || answer.status === 400 || answer.status === 401) throw new LinkExpired('The link to this part ran out.');
  if (answer.status === 416) return new Uint8Array(0);
  if (!answer.ok) throw new Error('A part of this mix could not be fetched.');
  if (answer.status === 206) return new Uint8Array(await answer.arrayBuffer());
  // the store ignored the range: read the body as it streams and keep only the bytes asked for
  const reader = answer.body?.getReader();
  if (!reader) return new Uint8Array(await answer.arrayBuffer()).slice(start, end);
  const out = new Uint8Array(end - start);
  let seen = 0;
  let put = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const from = Math.max(0, start - seen);
    const to = Math.min(value.length, end - seen);
    if (to > from) { out.set(value.subarray(from, to), put); put += to - from; }
    seen += value.length;
    if (seen >= end) { void reader.cancel(); break; }
  }
  return out.subarray(0, put);
}

function newContext(): Context {
  // an older Safari (before 14.1) has only the prefixed constructor
  const Made = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Made) throw new CannotDecode('this browser cannot play audio from a web page. Try it in another browser, or export the mix and play the download.');
  const make = (options?: AudioContextOptions) => new Made(options);
  try { return make({ sampleRate: RATE, latencyHint: 'playback' }); } catch { return make(); }
}

export class TimelinePlayer {
  private context: Context | null = null;
  private scheduled: Scheduled[] = [];
  private nextFrame = 0;
  private reader: { part: number; reader: PartReader; at: number } | null = null;
  private nextPart = 0;
  private nextAt = 0;
  private ending = false;
  private pumping = false;
  private live = false;
  private generation = 0;
  private cancelTimer: (() => void) | null = null;
  /** Aborts every read of the current position when the player stops or jumps elsewhere. */
  private reads = new AbortController();
  private linksAt: number;
  private refreshing: Promise<void> | null = null;
  private readonly deps: Required<PlayerDeps>;
  /** Decoded sample frames held now and at most (memory bound, for tests and diagnostics). */
  stats = { heldFrames: 0, peakHeldFrames: 0, windows: 0, underruns: 0, refreshes: 0 };
  state: PlayerState;

  constructor(
    private parts: TimelinePart[],
    private refresh: () => Promise<TimelinePart[]>,
    private onChange: (state: PlayerState) => void,
    deps: PlayerDeps = {},
  ) {
    this.deps = {
      context: deps.context ?? newContext,
      readUrl: deps.readUrl ?? readSignedUrl,
      every: deps.every ?? ((ms, run) => { const id = window.setInterval(run, ms); return () => window.clearInterval(id); }),
      sleep: deps.sleep ?? ((ms) => new Promise((done) => { window.setTimeout(done, ms); })),
      now: deps.now ?? Date.now,
      aheadS: deps.aheadS ?? AHEAD_S,
    };
    this.linksAt = this.deps.now();
    this.state = { playing: false, part: 0, at: 0, elapsed: 0, total: this.total(), waiting: false, error: null };
  }

  private total() { return this.parts.reduce((sum, part) => sum + part.seconds, 0); }
  private elapsedAt(part: number, at: number) { return this.parts.slice(0, part).reduce((sum, one) => sum + one.seconds, 0) + at; }

  /** New links (and any change to the timeline) from the server's latest answer. */
  setParts(parts: TimelinePart[]) {
    this.parts = parts;
    this.linksAt = this.deps.now();
    this.state = { ...this.state, total: this.total() };
  }

  private emit(change: Partial<PlayerState>) {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
  }

  /** Start from part `from`, `at` seconds in (default: the beginning). Call it inside the press:
   * the audio context is made before anything is awaited, so the browser lets it sound. */
  async play(from = 0, at = 0) {
    this.halt('keep');
    const generation = this.generation;
    let context: Context;
    try { context = this.context ?? this.deps.context(); } catch (problem) {
      // no Web Audio here at all: said plainly, never a silent press
      this.emit({ playing: false, waiting: false, error: problem instanceof Error && problem.message ? problem.message : CANNOT_DECODE });
      return;
    }
    this.context = context;
    this.live = true;
    this.nextPart = Math.max(0, Math.min(from, this.parts.length - 1));
    this.nextAt = Math.max(0, at);
    this.ending = false;
    this.emit({ playing: true, part: this.nextPart, at: this.nextAt, elapsed: this.elapsedAt(this.nextPart, this.nextAt), total: this.total(), waiting: true, error: null });
    if (context.state !== 'running') await context.resume?.().catch(() => undefined);
    if (generation !== this.generation) return;
    this.nextFrame = Math.ceil((context.currentTime + LEAD_S) * context.sampleRate);
    this.cancelTimer = this.deps.every(TICK_MS, () => this.tick());
    await this.pump();
  }

  /** Seconds of audio scheduled ahead of the clock. */
  private ahead(): number {
    const context = this.context;
    return context ? this.nextFrame / context.sampleRate - context.currentTime : 0;
  }

  private async links(force = false): Promise<void> {
    if (!force && this.deps.now() - this.linksAt < LINK_LIFE_MS) return;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          this.stats.refreshes += 1;
          const fresh = await this.refresh();
          this.parts = fresh;
          this.linksAt = this.deps.now();
        } finally { this.refreshing = null; }
      })();
    }
    await this.refreshing;
  }

  private urlOf(index: number): string {
    const url = this.parts[index]?.url;
    if (!url) throw new Error('This part of the mix is still being prepared.');
    return url;
  }

  private bytesOf(index: number): ReadBytes {
    const signal = this.reads.signal;
    const stale = () => { if (signal.aborted) throw new DOMException('The player moved on.', 'AbortError'); };
    return async (start, end) => {
      stale();
      await this.links();
      stale();
      try {
        return await this.deps.readUrl(this.urlOf(index), start, end, signal);
      } catch (problem) {
        if (!(problem instanceof LinkExpired)) throw problem;
        await this.links(true);
        stale();
        return this.deps.readUrl(this.urlOf(index), start, end, signal);
      }
    };
  }

  /** A step that may fail on a bad connection: tried again a few times, a second or more apart. */
  private async patiently<T>(generation: number, step: () => Promise<T>): Promise<T> {
    let wait = 1000;
    for (let tried = 1; ; tried += 1) {
      try { return await step(); } catch (problem) {
        if (tried >= TRIES || generation !== this.generation || problem instanceof LinkExpired || (problem as Error | null)?.name === 'AbortError') throw problem;
        if (this.ahead() < 2) this.emit({ waiting: true });
        await this.deps.sleep(wait);
        wait *= 2;
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.context) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      while (generation === this.generation && this.live && this.context && !this.ending && this.ahead() < this.deps.aheadS) {
        if (!this.reader) {
          if (this.nextPart >= this.parts.length) { this.ending = true; break; }
          const part = this.parts[this.nextPart];
          const reader = new PartReader(this.bytesOf(this.nextPart), part.from_s, part.seconds, part.url ? fileKey(part.url) : null);
          const skip = Math.min(this.nextAt, Math.max(0, part.seconds - 0.01));
          await this.patiently(generation, () => reader.open(skip));
          if (generation !== this.generation) return;
          this.reader = { part: this.nextPart, reader, at: skip };
          this.nextAt = 0;
        }
        const current = this.reader;
        const window = await this.patiently(generation, () => current.reader.next());
        if (generation !== this.generation || !this.context) return;
        if (!window) { this.reader = null; this.nextPart = current.part + 1; continue; }
        const decoded = await this.decode(window.file);
        if (generation !== this.generation || !this.context) return;
        this.schedule(decoded, current, window.skip, window.keep);
        if (window.last) { this.reader = null; this.nextPart = current.part + 1; }
      }
    } catch (problem) {
      if (generation === this.generation) this.fail(problem);
    } finally {
      if (generation === this.generation) this.pumping = false;
    }
  }

  /** Decode one window. Callbacks as well as the promise (an older Safari returns no promise), a
   * time limit (a decoder that never answers must not hang the player) and a plain failure. */
  private async decode(file: Uint8Array): Promise<AudioBuffer> {
    const context = this.context!;
    const bytes = file.buffer.byteLength === file.length && file.byteOffset === 0 ? file.buffer as ArrayBuffer : file.slice().buffer;
    const decoded = new Promise<AudioBuffer>((done, refused) => {
      try {
        const promised = context.decodeAudioData(bytes, done, () => refused(new CannotDecode(CANNOT_DECODE)));
        void promised?.then?.(done, () => refused(new CannotDecode(CANNOT_DECODE)));
      } catch { refused(new CannotDecode(CANNOT_DECODE)); }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_done, refused) => { timer = globalThis.setTimeout(() => refused(new CannotDecode(CANNOT_DECODE)), DECODE_LIMIT_MS); });
    const audio = await Promise.race([decoded, late]).finally(() => globalThis.clearTimeout(timer));
    if (!audio || typeof audio.getChannelData !== 'function' || audio.length === 0) throw new CannotDecode(CANNOT_DECODE);
    return audio;
  }

  private schedule(audio: AudioBuffer, current: { part: number; reader: PartReader; at: number }, skipIn: number, keepIn: number) {
    const context = this.context!;
    const part = this.parts[current.part];
    let skip = skipIn;
    let keep = keepIn;
    if (skip < 0) { // a whole file that isn't FLAC: cut the part out of it here
      skip = Math.round((part.from_s + current.at) * audio.sampleRate);
      keep = Math.round((part.seconds - current.at) * audio.sampleRate);
    } else if (current.reader.stream && audio.sampleRate !== current.reader.stream.sampleRate) {
      const scale = audio.sampleRate / current.reader.stream.sampleRate; // the context resampled it
      skip = Math.round(skip * scale);
      keep = Math.round(keep * scale);
    }
    keep = Math.max(0, Math.min(keep, audio.length - skip));
    if (keep <= 0) return;
    let buffer = audio;
    if (skip > 0 || keep < audio.length) {
      buffer = context.createBuffer(audio.numberOfChannels, keep, audio.sampleRate);
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        buffer.copyToChannel(audio.getChannelData(channel).subarray(skip, skip + keep), channel);
      }
    }
    const rate = context.sampleRate;
    if (this.nextFrame / rate < context.currentTime + 0.02) {
      // the window came too late (a slow connection): carry on from now, with a short gap
      this.stats.underruns += 1;
      this.nextFrame = Math.ceil((context.currentTime + LEAD_S) * rate);
    }
    const when = this.nextFrame / rate;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const level = context.createGain();
    level.gain.value = part.kind === 'song' ? 10 ** ((part.gain_db ?? 0) / 20) : 1;
    source.connect(level);
    level.connect(context.destination);
    source.start(when);
    const length = Math.round(buffer.length * rate / buffer.sampleRate);
    const item: Scheduled = { source, level, when, end: when + length / rate, part: current.part, partAt: current.at, samples: buffer.length * buffer.numberOfChannels };
    source.onended = () => this.release(item);
    this.scheduled.push(item);
    this.nextFrame += length;
    current.at += buffer.length / buffer.sampleRate;
    this.stats.windows += 1;
    this.stats.heldFrames += item.samples;
    this.stats.peakHeldFrames = Math.max(this.stats.peakHeldFrames, this.stats.heldFrames);
  }

  /** A window that has played: its audio is let go. */
  private release(item: Scheduled) {
    const at = this.scheduled.indexOf(item);
    if (at < 0) return;
    this.scheduled.splice(at, 1);
    this.stats.heldFrames -= item.samples;
    try { item.source.disconnect(); item.level.disconnect(); } catch { /* already gone */ }
    item.source.buffer = null;
  }

  private tick() {
    const context = this.context;
    if (!context || !this.live) return;
    const now = context.currentTime;
    for (const item of [...this.scheduled]) if (item.end <= now) this.release(item);
    const playingNow = this.scheduled.find((item) => item.when <= now && now < item.end);
    if (playingNow) {
      const at = playingNow.partAt + (now - playingNow.when);
      this.emit({ part: playingNow.part, at, elapsed: this.elapsedAt(playingNow.part, at), waiting: false });
    } else if (this.ending && !this.scheduled.length) {
      this.halt();
      this.emit({ playing: false, part: 0, at: 0, elapsed: 0, waiting: false });
      return;
    } else if (now > LEAD_S && !this.scheduled.some((item) => item.when > now)) {
      this.emit({ waiting: true });
    }
    void this.pump();
  }

  private fail(problem: unknown) {
    const message = problem instanceof Error && problem.message ? problem.message : 'This mix stopped part way.';
    const { part, at } = this.state;
    this.halt();
    this.emit({ playing: false, waiting: false, error: message, part, at });
  }

  /** Silence everything and let every decoded window go; abandoned reads are aborted. The context
   * is suspended (`suspend`, a stop), left running for the next start (`keep`, a jump: suspending
   * here would land after the new start's resume and freeze it), or closed (`close`). */
  private halt(context_: 'suspend' | 'keep' | 'close' = 'suspend') {
    this.generation += 1;
    this.live = false;
    this.reads.abort();
    this.reads = new AbortController();
    this.cancelTimer?.();
    this.cancelTimer = null;
    for (const item of this.scheduled) {
      try { item.source.onended = null; item.source.stop(); } catch { /* not started */ }
      try { item.source.disconnect(); item.level.disconnect(); } catch { /* already gone */ }
    }
    this.scheduled = [];
    this.stats.heldFrames = 0;
    this.reader = null;
    this.pumping = false;
    const context = this.context;
    if (context_ === 'close') {
      this.context = null;
      void context?.close?.().catch(() => undefined);
    } else if (context_ === 'suspend') {
      // kept, silent, for the next Play: making a context can hold the page for most of a second
      void context?.suspend?.().catch(() => undefined);
    }
  }

  /** Stop where it is and let every decoded window go (Play again starts from there with
   * `play(state.part, state.at)`). The silent context is kept until `close`. */
  stop() {
    const was = this.state.playing;
    this.halt();
    if (was) this.emit({ playing: false, waiting: false });
  }

  /** Stop and close the audio context (leaving the page). */
  close() {
    const was = this.state.playing;
    this.halt('close');
    if (was) this.emit({ playing: false, waiting: false });
  }
}
