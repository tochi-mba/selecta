import type { SongFacts } from '../dsp/analysis/song';
import { LEAVE_AFTER_SECONDS } from '../dsp/seams';
import { SeamRenderer } from '../dsp/workers/renderSpawn';
import { accountMeasured, askWithin, type Request } from './accountFacts';
import { createClipStore } from './clipStore';
import { DeviceStudio, type CandidatesAnswer, type StudioSong } from './deviceStudio';
import { songFacts } from './songFacts';

/** The device studio as the shell's player wires it (cloud.device_render): the planner's answers
 * from the account, songs decoded by the playing speaker, one render worker, clips kept on the
 * device. The only requests are the planning routes the account already answers; no audio and no
 * clip ever leaves the device (deviceToAccount.egress.test.ts). */

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
};

// the account's request for each workspace whose player made a studio, so the Listening Room can
// hear the planner's choices without being handed the account by the shell
const access = new Map<string, Request>();
export const planningAccess = (workspaceId: string): Request | null => access.get(workspaceId) ?? null;

export function makeDeviceStudio(wiring: StudioWiring): DeviceStudio {
  access.set(wiring.workspaceId, wiring.request);
  const renderer = new SeamRenderer();
  const factsOf = wiring.facts ?? ((sha: string) => songFacts(sha));
  const post = <T,>(path: string, body: unknown) => askWithin<T>(wiring.request, path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, PLANNING_WITHIN_MS);
  return new DeviceStudio({
    candidates: (a, b) => post<CandidatesAnswer>('/planning/candidates', { a, b, leave_after: LEAVE_AFTER_SECONDS, scripts: STUDIO_SCRIPTS }),
    script: async (a, b, index, fingerprint) => (await post<{ script?: unknown }>('/planning/candidates/script', { a, b, leave_after: LEAVE_AFTER_SECONDS, option: index, fingerprint }))?.script ?? null,
    measured: async (a: StudioSong, b: StudioSong) => {
      const [one, two] = await Promise.all([factsOf(a.sha), factsOf(b.sha)]);
      if (!one?.row || !two?.row) return false;
      const account = await accountMeasured(wiring.request, wiring.workspaceId);
      return account.has(a.songId) && account.has(b.songId);
    },
    audio: (index) => wiring.decodedAt(index),
    level: (buffer) => wiring.level(buffer),
    // every window is cut for its call alone, so it is moved to the worker, never copied
    render: (script, sources, options) => renderer.render(script, sources, { signal: options.signal, timeoutMs: options.timeoutMs, owned: true }),
    store: createClipStore(),
    log: import.meta.env.DEV ? (line) => console.info(line) : undefined,
    stop: () => renderer.end(),
  });
}
