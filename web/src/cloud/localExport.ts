import { ApiError, type ExportJob, type MixData, type Request } from '../api';
import type { RenderedClip } from '../dsp/seams';
import { exportFile } from '../engine/export';
import { ENGINE_SAMPLE_RATE } from '../engine/context';
import { createLevels, type Levels } from '../engine/level';
import { flagListed, flagOn } from '../flags';
import type { MediaResolver } from '../media';
import { cloudExportParts } from './cloudExport';
import { cloudFileFamily } from './cloudFileExport';
import { oneMixerOn } from './musicHomes';
import { deviceRenderOn, SEAM_BUDGET_MS, type DeviceStudio, type StudioSong } from './deviceStudio';
import { makeDeviceStudio, songsHere } from './studioWiring';

/** Saving a mix as an audio file in the browser (ADR-0457 BF-0457-06, T-20261126-96d3).
 *
 * The shared Export panel and job list ask the Desktop's export routes (`/exports/jobs`); here
 * they are answered on this device. A job freezes the mix as it is shown, then:
 *
 * 1. Prepares each transition the way playback plays it: the clip this device made ahead (kept
 *    on the device) or, when there is none, one made now with the same seam maker and the
 *    planner's options (`cloud.device_render`). Each counts towards "n of m ready".
 * 2. Writes the mix with engine/export.ts: each song at the level it plays at, each prepared
 *    clip joined as the scheduler joins it (render.ts with renderedSeam.ts), the crossfade where
 *    a boundary has no clip, the true-peak limiter, then a FLAC file checked by decoding every
 *    frame and its MD5.
 * 3. Hands the finished file to the page as a link in memory; the member's own press saves it.
 *
 * Cancel works at any point and leaves no file. Nothing is uploaded: the only requests are the
 * planning and report requests the device studio makes for any transition (no audio, no path). A
 * job lives while this tab is open.
 *
 * With `cloud.one_mixer` a song in the cloud library is saved too: its bytes are read through
 * the player's own resolver to this device, never sent anywhere. A transition next to one has no
 * clip made for it and is joined as playback blends it live. A song only on another device, or
 * nowhere, is left out by name and the rest is saved.
 *
 * With `cloud.studio_seams` a transition between two songs with their own cloud copy is the cloud
 * studio's clip, joined with the same arithmetic, each song next to it read from its lossless file
 * at the clip's level (cloudExport.ts). */

/** With `cloud.local_export` named on by the server. */
export const localExportOn = (): boolean => flagListed('cloud.local_export');
/** With `cloud.one_mixer` named on, or the cloud-only shell: songs in the cloud library are saved too. */
export const bothPlacesOn = (): boolean => oneMixerOn();

export const NOT_HERE = (title: string) => `${title} isn’t on this device, so this mix can’t be saved as a file here.`;
export const ON_DEVICE = (title: string, device: string) => `${title} is only on ${device}, so it was left out of this file.`;
export const NOWHERE = (title: string) => `${title} can’t be read on this device and isn’t in your cloud library, so it was left out of this file.`;
export const TOO_FEW = 'A file needs at least two songs that this device can read.';

/** `song`: the file on this device, for its transitions; null for a cloud library copy. */
type Song = { song: StudioSong | null; data(): Promise<ArrayBuffer> };
type Running = { job: ExportJob; control: AbortController; frozen: MixData; url: string | null };

const jobs = new Map<string, Running>();
const listeners = new Set<() => void>();
let levels: Levels | null = null;
const levelOf = (buffer: AudioBuffer): Promise<number> => (flagOn('cloud.seam_lead') ? (levels ??= createLevels()).of(buffer) : Promise.resolve(1));
// the same decode the playing context makes: its rate, the browser's own decoder
const decode = (bytes: ArrayBuffer): Promise<AudioBuffer> => new OfflineAudioContext(2, 1, ENGINE_SAMPLE_RATE).decodeAudioData(bytes);

const refuse = (message: string, code: string, status = 409) => new ApiError(message, status, code, 'device-music:export');

function changed(running: Running, next: Partial<ExportJob>): void {
  running.job = { ...running.job, ...next };
  for (const listener of [...listeners]) listener();
}

/** A file name from the mix's name: letters, digits, spaces and dashes only. */
export function fileName(mixName: string, at = new Date()): string {
  const base = mixName.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'SelectaDJ mix';
  return `${base} ${at.toISOString().slice(0, 10)}.flac`;
}

export type ExportDeps = {
  workspaceId: string;
  /** The account's API, for the transitions' planning (the studio's own requests). */
  cloud: Request;
  /** A song by id, on this device; the player's own resolver by default. */
  songOf?: (songId: number) => Promise<Song | null>;
  /** `cloud.one_mixer`: the player's resolver (this device first, then the cloud library), for a
   * song `songOf` has no file of; registered by the shell (`exportReaders`) by default. */
  resolve?: () => Promise<MediaResolver | null>;
  /** `cloud.one_mixer`: another of the member's devices that holds a song, by name. */
  heldBy?: (songId: number) => string | null;
  /** The transition maker for the export; the device studio by default. */
  studio?: () => DeviceStudio | null;
  /** The finished file as a link; an object URL by default. */
  link?: (bytes: Uint8Array) => string;
  write?: typeof exportFile;
  decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  level?: (buffer: AudioBuffer) => Promise<number>;
  /** `cloud.one_mixer`: of these song ids, those with their OWN cloud copy (`ownCloudCopies`),
   * for "Make the file in your cloud library" (cloudFileExport.ts). */
  inCloud?: (songIds: readonly number[]) => Promise<ReadonlySet<number>>;
};

/** One transition per boundary, made ahead or now; null where none can be had (crossfade). */
async function prepare(running: Running, songs: Song[], deps: ExportDeps): Promise<(RenderedClip | null)[]> {
  const total = songs.length - 1;
  const clips: (RenderedClip | null)[] = new Array(total).fill(null);
  const studio = deviceRenderOn() ? (deps.studio?.() ?? null) : null;
  if (!studio) {
    changed(running, { seams_ready: total });
    return clips;
  }
  const read = deps.decode ?? decode;
  const level = deps.level ?? levelOf;
  // a cancel stops the transition in hand at once: the studio abandons its render
  const signal = running.control.signal;
  const stopped = new Promise<null>((done) => signal.addEventListener('abort', () => { studio.dispose(); done(null); }, { once: true }));
  try {
    // decoded only for a pair of files on this device: a cloud copy's transition is blended live
    let from: AudioBuffer | null = null;
    let fromAt = -1;
    for (let index = 0; index < total; index += 1) {
      if (running.control.signal.aborted) break;
      const a = songs[index].song;
      const b = songs[index + 1].song;
      if (a && b) {
        if (fromAt !== index || !from) from = await read(await songs[index].data());
        const to = await read(await songs[index + 1].data());
        const levels = { a: await level(from).catch(() => 1), b: await level(to).catch(() => 1) };
        const made = await Promise.race([studio.clipFor({ a, b, from, to, levels }, SEAM_BUDGET_MS).catch(() => null), stopped]);
        clips[index] = made?.status === 'clip' ? made.rendered : null;
        from = to;
        fromAt = index + 1;
      }
      changed(running, { seams_ready: index + 1 });
    }
  } finally {
    studio.dispose();
  }
  return clips;
}

/** A song read through the player's resolver: its file here, or its cloud library copy, read to
 * this device (cloud.one_mixer). */
async function readable(songId: number, deps: ExportDeps): Promise<Song | null> {
  const found = await (await deps.resolve?.().catch(() => null))?.(songId).catch(() => null);
  if (!found) return null;
  return { song: (found.source ?? 'device') === 'device' && found.held ? found.held : null, data: found.data };
}

/** The songs this device can read, with the mix items they are, and why each other one was left
 * out. With `cloud.one_mixer` off, any song not on this device stops the whole file, as before. */
async function gather(frozen: MixData, deps: ExportDeps): Promise<{ songs: Song[]; items: MixData['mix']; left: string[] }> {
  const songOf = deps.songOf ?? (async (songId: number) => (await songsHere(deps.workspaceId)?.(songId)) ?? null);
  const both = bothPlacesOn();
  const songs: Song[] = [];
  const items: MixData['mix'] = [];
  const left: string[] = [];
  for (const item of frozen.mix) {
    const title = item.title || 'A song';
    const found = (await songOf(item.song_id).catch(() => null)) ?? (both ? await readable(item.song_id, deps) : null);
    if (found) {
      songs.push(found);
      items.push(item);
      continue;
    }
    if (!both) throw new Error(NOT_HERE(title));
    const device = deps.heldBy?.(item.song_id) ?? null;
    left.push(device ? ON_DEVICE(title, device) : NOWHERE(title));
  }
  if (songs.length < 2) throw new Error([...left, TOO_FEW].join(' '));
  return { songs, items, left };
}

async function run(running: Running, deps: ExportDeps): Promise<void> {
  const { frozen, control } = running;
  try {
    const { songs, items, left } = await gather(frozen, deps);
    // what was left out is said on the job, and the rest is saved
    if (left.length) changed(running, { error: left.join(' '), seams_total: songs.length - 1 });
    // cloud.studio_seams: the transitions made in the cloud, and their songs' lossless files
    const cloud = deps.inCloud
      ? await cloudExportParts(items, { request: deps.cloud, inCloud: deps.inCloud, decode: deps.decode ?? decode, usual: (index) => songs[index].data() }, control.signal)
      : null;
    // a song read from its lossless file is joined by the cloud's clips, never the device studio's
    const clips = await prepare(running, cloud ? songs.map((one, index) => (cloud.songs.has(index) ? { ...one, song: null } : one)) : songs, deps);
    if (control.signal.aborted) return changed(running, { state: 'cancelled', can_cancel: false });
    changed(running, { state: 'encoding' });
    const level = deps.level ?? levelOf;
    const result = await (deps.write ?? exportFile)({
      format: 'flac',
      tracks: songs.map((one, index) => ({ id: items[index].song_id, data: cloud?.songs.get(index)?.data ?? one.data })),
      decode: deps.decode ?? decode,
      sampleRate: ENGINE_SAMPLE_RATE,
      // a cloud song at its clip's level, as playback plays it
      level: async (index, buffer) => cloud?.songs.get(index)?.level ?? level(buffer),
      joins: async (index) => cloud?.clips.get(index) ?? clips[index] ?? null,
      signal: control.signal,
    });
    if (!result.ok) {
      if (result.reason === 'cancelled') return changed(running, { state: 'cancelled', can_cancel: false });
      return changed(running, { state: 'failed', can_cancel: false, error: result.detail });
    }
    const bytes = result.file.bytes;
    running.url = (deps.link ?? ((made: Uint8Array) => URL.createObjectURL(new Blob([made as BlobPart], { type: 'audio/flac' }))))(bytes);
    changed(running, { state: 'ready', can_cancel: false, seconds: result.file.durationSeconds, url: running.url });
  } catch (problem) {
    if (control.signal.aborted) return changed(running, { state: 'cancelled', can_cancel: false });
    changed(running, { state: 'failed', can_cancel: false, error: problem instanceof Error ? problem.message : 'The export stopped.' });
  }
}

function start(frozen: MixData, scope: 'current' | 'draft', draft: number | null, deps: ExportDeps): ExportJob {
  const at = Date.now();
  const id = `here-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const items = frozen.mix;
  const job: ExportJob = {
    id, state: 'preparing', scope, draft, mix_name: frozen.name || 'Current mix',
    revision: items.map((item) => item.song_id).join('-').slice(0, 64),
    songs: items.map((item) => ({ song_id: item.song_id, title: item.title, artist: item.artist })),
    seams: items.slice(1).map((item, index) => ({ key: item.seam?.state.key ?? `${index + 1}`, from: items[index].title, to: item.title })),
    seams_total: Math.max(0, items.length - 1), seams_ready: 0,
    seconds_estimate: items.reduce((total, item) => total + (item.duration || 0), 0),
    name: fileName(frozen.name || 'Current mix', new Date(at)), seconds: null, error: null, created_at: at / 1000,
    can_cancel: true, quiet_seconds: 0, shape: null,
  };
  const running: Running = { job, control: new AbortController(), frozen, url: null };
  jobs.set(id, running);
  void run(running, deps);
  return job;
}

export type ExportFamily = {
  answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit) => Promise<unknown> | undefined;
};

/** `/exports/jobs` as the shared panel asks it. `mix` reads the mix being saved (the adapter's
 * own `GET /mix`, with the draft when there is one). */
export function exportFamily(deps: ExportDeps & { mix: (draft: number | null) => Promise<MixData> }): ExportFamily {
  // cloud.one_mixer: "Make the file in your cloud library", its own module and requests
  const inCloud = deps.inCloud;
  const elsewhere = inCloud ? cloudFileFamily({ cloud: deps.cloud, mix: deps.mix, inCloud }) : null;
  return {
    answer: (method, route, query, init) => {
      const there = elsewhere?.answer(method, route, query, init);
      if (there) return there;
      if (route !== '/exports/jobs' && !route.startsWith('/exports/jobs/')) return undefined;
      if (!localExportOn()) return Promise.reject(refuse('Saving a mix as a file is switched off for this account.', 'flag_off', 403));
      if (method === 'GET' && route === '/exports/jobs') return Promise.resolve({ jobs: [...jobs.values()].map((one) => one.job).reverse() });
      if (method === 'POST' && route === '/exports/jobs') {
        const draft = query.get('draft') ? Number(query.get('draft')) : null;
        return (async () => {
          const mix = await deps.mix(draft);
          let expected: string | null = null;
          try { expected = new Headers(init?.headers).get('x-mix-order'); } catch { /* no guard */ }
          if (expected !== null && expected !== mix.mix.map((item) => item.song_id).join(',')) throw refuse('The mix changed. Look at it again, then save it.', 'mix_changed');
          if (mix.mix.length < 2) throw refuse('A mix needs at least two songs to save as a file.', 'too_short', 400);
          return start(mix, draft === null ? 'current' : 'draft', draft, deps);
        })();
      }
      const one = /^\/exports\/jobs\/([\w-]+)(\/again)?$/.exec(route);
      const running = one ? jobs.get(one[1]) : undefined;
      if (!one || !running) return Promise.reject(refuse('That export isn’t here any more.', 'not_found', 404));
      if (method === 'DELETE' && !one[2]) {
        if (running.job.can_cancel) {
          running.control.abort();
          changed(running, { state: 'cancelling' });
        }
        return Promise.resolve(running.job);
      }
      if (method === 'POST' && one[2]) return Promise.resolve(start(running.frozen, running.job.scope, running.job.draft, deps));
      return Promise.reject(refuse('That isn’t something an export does here.', 'not_found', 404));
    },
  };
}

/** For the tests: forget every job. */
export function forgetExports(): void {
  for (const running of jobs.values()) running.control.abort();
  jobs.clear();
}

/** The export's own transition maker: the device studio's pieces, apart from the player's. */
export function exportStudio(workspaceId: string, cloud: Request): () => DeviceStudio | null {
  return () => (typeof Worker === 'undefined' ? null : makeDeviceStudio({ request: cloud, workspaceId, decodedAt: async () => null, level: levelOf }));
}
