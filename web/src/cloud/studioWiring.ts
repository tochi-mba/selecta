import type { SongFacts } from '../dsp/analysis/song';
import { LEAVE_AFTER_SECONDS } from '../dsp/seams';
import { SeamRenderer } from '../dsp/workers/renderSpawn';
import { accountMeasured, askWithin, type Request } from './accountFacts';
import { createClipStore } from './clipStore';
import { DeviceStudio, type Asker, type CandidatesAnswer, type StudioSong } from './deviceStudio';
import { reportSeam } from './seamReports';
import { songFacts } from './songFacts';

/** The device studio as the shell's player wires it (cloud.device_render): the planner's answers
 * from the account, songs decoded by the playing speaker, one render worker, clips kept on the
 * device. The only requests are the planning routes and, with cloud.brain on, a report of each
 * clip made (its facts, length and hash); no audio and no clip ever leaves the device
 * (deviceToAccount.egress.test.ts). */

/** Options sent with their scripts: the rule renders at most five takes (cloud-planning.md). */
export const STUDIO_SCRIPTS = 8;
/** One planning request may take this long; the seam is prepared minutes ahead. */
export const PLANNING_WITHIN_MS = 20_000;

export type StudioWiring = {
  request: Request;
  workspaceId: string;
  /** The decoded song at a mix position, from the speaker that will play it. */
  decodedAt(index: number): Promise<AudioBuffer | null>;
  level(buffer: AudioBuffer): Promise<number>;
  facts?(sha: string): Promise<SongFacts | null>;
  /** A song by catalogue id when its file is on this device: the file's hash and its decode, the
   * speaker's own. For a request's transitions, whose song is not in the mix yet. */
  songHere?(songId: number): Promise<{ song: StudioSong; decoded(): Promise<AudioBuffer | null> } | null>;
};

// the account's request for each workspace whose player made a studio, so the Listening Room can
// hear the planner's choices without being handed the account by the shell
const access = new Map<string, Request>();
export const planningAccess = (workspaceId: string): Request | null => access.get(workspaceId) ?? null;

// the studio of each workspace's player, so the requests adapter can ask it for a request's
// transitions (T-20261126-a246) and the Activity drawer can show its work (T-20261126-36c7)
type Kept = { studio: DeviceStudio; songHere: StudioWiring['songHere'] };
const studios = new Map<string, Kept>();
export const studioOf = (workspaceId: string): DeviceStudio | null => studios.get(workspaceId)?.studio ?? null;
/** Subscribed to by the Activity drawer, told when a player makes or ends its studio. */
const studioListeners = new Set<() => void>();
export function onStudios(listener: () => void): () => void {
  studioListeners.add(listener);
  return () => { studioListeners.delete(listener); };
}
const studiosChanged = () => { for (const listener of [...studioListeners]) listener(); };

/** Ask this workspace's studio to make the transitions a waiting request's placement needs,
 * pairs of catalogue song ids. Songs whose file is not on this device are skipped: another device
 * makes its own. Returns how many pairs it could ask for. */
export async function prepareRequestSeams(workspaceId: string, pairs: readonly { a: number; b: number }[], asker: Asker = 'requests'): Promise<number> {
  const kept = studios.get(workspaceId);
  if (!kept?.songHere) return 0;
  const ids = [...new Set(pairs.flatMap((pair) => [pair.a, pair.b]))];
  const found = new Map<number, StudioSong>();
  await Promise.all(ids.map(async (id) => {
    const here = await kept.songHere!(id).catch(() => null);
    if (here) found.set(id, here.song);
  }));
  const asked = pairs.flatMap((pair) => {
    const a = found.get(pair.a);
    const b = found.get(pair.b);
    return a && b ? [{ a, b }] : [];
  });
  if (studios.get(workspaceId) === kept) kept.studio.prepareFor(asked, asker);
  return asked.length;
}

/** The two planning requests the studio makes: song ids, the settle rule and an index, no more. */
export function planningCalls(request: Request) {
  const post = <T,>(path: string, body: unknown) => askWithin<T>(request, path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, PLANNING_WITHIN_MS);
  return {
    candidates: (a: number, b: number) => post<CandidatesAnswer>('/planning/candidates', { a, b, leave_after: LEAVE_AFTER_SECONDS, scripts: STUDIO_SCRIPTS }),
    script: async (a: number, b: number, index: number, fingerprint: string) => (await post<{ script?: unknown }>('/planning/candidates/script', { a, b, leave_after: LEAVE_AFTER_SECONDS, option: index, fingerprint }))?.script ?? null,
  };
}

export function makeDeviceStudio(wiring: StudioWiring): DeviceStudio {
  access.set(wiring.workspaceId, wiring.request);
  // the decode for each song a request needs, by its file's hash
  const decodes = new Map<string, () => Promise<AudioBuffer | null>>();
  const songHere = wiring.songHere && (async (songId: number) => {
    const here = await wiring.songHere!(songId);
    if (here) {
      decodes.set(here.song.sha, here.decoded);
      while (decodes.size > 16) decodes.delete(decodes.keys().next().value as string);
    }
    return here;
  });
  const renderer = new SeamRenderer();
  const factsOf = wiring.facts ?? ((sha: string) => songFacts(sha));
  const calls = planningCalls(wiring.request);
  const studio = new DeviceStudio({
    candidates: calls.candidates,
    script: calls.script,
    measured: async (a: StudioSong, b: StudioSong) => {
      const [one, two] = await Promise.all([factsOf(a.sha), factsOf(b.sha)]);
      if (!one?.row || !two?.row) return false;
      const account = await accountMeasured(wiring.request, wiring.workspaceId);
      return account.has(a.songId) && account.has(b.songId);
    },
    audio: (index) => wiring.decodedAt(index),
    songAudio: wiring.songHere ? async (song) => (await decodes.get(song.sha)?.()) ?? null : undefined,
    level: (buffer) => wiring.level(buffer),
    // every window is cut for its call alone, so it is moved to the worker, never copied
    render: (script, sources, options) => renderer.render(script, sources, { signal: options.signal, timeoutMs: options.timeoutMs, owned: true }),
    store: createClipStore(),
    log: import.meta.env.DEV ? (line) => console.info(line) : undefined,
    stop: () => {
      renderer.end();
      if (studios.get(wiring.workspaceId)?.studio === studio) {
        studios.delete(wiring.workspaceId);
        studiosChanged();
      }
    },
    // after the clip is in hand, off the path the music takes
    report: (pair, made, answer) => { setTimeout(() => void reportSeam(wiring.request, wiring.workspaceId, made, pair, answer), 0); },
  });
  // only the player's studio is kept: the Listening Room's own (no songHere) works for itself
  if (wiring.songHere) {
    studios.set(wiring.workspaceId, { studio, songHere });
    studiosChanged();
  }
  return studio;
}
