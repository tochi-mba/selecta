import { ApiError, type ExportJob, type MixData, type Request } from '../api';
import type { RenderedClip } from '../dsp/seams';
import { exportFile } from '../engine/export';
import { ENGINE_SAMPLE_RATE } from '../engine/context';
import { createLevels, type Levels } from '../engine/level';
import { flagListed, flagOn } from '../flags';
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
 * job lives while this tab is open. */

/** With `cloud.local_export` named on by the server. */
export const localExportOn = (): boolean => flagListed('cloud.local_export');

export const NOT_HERE = (title: string) => `${title} isn’t on this device, so this mix can’t be saved as a file here.`;

type Song = { song: StudioSong; data(): Promise<ArrayBuffer> };
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
  /** The transition maker for the export; the device studio by default. */
  studio?: () => DeviceStudio | null;
  /** The finished file as a link; an object URL by default. */
  link?: (bytes: Uint8Array) => string;
  write?: typeof exportFile;
  decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  level?: (buffer: AudioBuffer) => Promise<number>;
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
    let from = await read(await songs[0].data());
    for (let index = 0; index < total; index += 1) {
      if (running.control.signal.aborted) break;
      const to = await read(await songs[index + 1].data());
      const levels = { a: await level(from).catch(() => 1), b: await level(to).catch(() => 1) };
      const made = await Promise.race([studio.clipFor({ a: songs[index].song, b: songs[index + 1].song, from, to, levels }, SEAM_BUDGET_MS).catch(() => null), stopped]);
      clips[index] = made?.status === 'clip' ? made.rendered : null;
      changed(running, { seams_ready: index + 1 });
      from = to;
    }
  } finally {
    studio.dispose();
  }
  return clips;
}

async function run(running: Running, deps: ExportDeps): Promise<void> {
  const { frozen, control } = running;
  const songOf = deps.songOf ?? (async (songId: number) => (await songsHere(deps.workspaceId)?.(songId)) ?? null);
  try {
    const songs: Song[] = [];
    for (const item of frozen.mix) {
      const found = await songOf(item.song_id).catch(() => null);
      if (!found) throw new Error(NOT_HERE(item.title || 'A song'));
      songs.push(found);
    }
    const clips = await prepare(running, songs, deps);
    if (control.signal.aborted) return changed(running, { state: 'cancelled', can_cancel: false });
    changed(running, { state: 'encoding' });
    const level = deps.level ?? levelOf;
    const result = await (deps.write ?? exportFile)({
      format: 'flac',
      tracks: songs.map((one, index) => ({ id: frozen.mix[index].song_id, data: one.data })),
      decode: deps.decode ?? decode,
      sampleRate: ENGINE_SAMPLE_RATE,
      level: (_index, buffer) => level(buffer),
      joins: async (index) => clips[index] ?? null,
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
  return {
    answer: (method, route, query, init) => {
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
