import type { MadeSeam } from '../dsp/render/seamMaker';
import { derivedStore, type DerivedStore } from '../media/derived';

/** Finished transitions kept on this device (cloud.device_render), so replaying a mix or opening
 * the tab again does not render them again (docs/engineering/device-studio-playback.md).
 *
 * A clip is a pure function of the two songs' bytes, the planner's options for them, the levels
 * they play at and the renderer, so it lives in the device-wide derived store (media/derived.ts)
 * under a hash of exactly those: both songs' content hashes, the planning answer's fingerprint,
 * the two levels and the implementation ids. Nothing a person typed or chose is in the key or the
 * value. Clips are the store's largest rows: they are never held in memory by the store, the
 * store evicts them before any measurement when the browser runs short, and this module keeps them
 * under their own byte budget, least recently used first. Clips never leave the device.
 */

export const CLIP_VERSION = 'seam-clip-1';
const INDEX_VERSION = 'seam-clip-index-1';
/** At most this much rendered audio is kept: about eleven 30-second transitions. */
export const CLIP_BUDGET_BYTES = 128 * 1024 * 1024;

export type ClipKey = { shaA: string; shaB: string; fingerprint: string; levels: { a: number; b: number }; implementation: string };

/** What is stored: the made seam without its attempts (those described the first making). */
type Stored = {
  rendered: MadeSeam['rendered'];
  move: string;
  option: number | 'fallback';
  passed: boolean;
  nearMiss: boolean;
  fellBack: boolean;
  beatsAligned: boolean;
  /** [check, value, limit, fix] for each failed check. */
  failures: [string, number, number, string | null][];
};
type Index = { clips: [string, number, number][] };

export type ClipStore = {
  get(key: ClipKey): Promise<MadeSeam | null>;
  put(key: ClipKey, made: MadeSeam): Promise<void>;
};

async function sha256(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** The key's hash: every input that changes the clip, levels as the sound card holds them. */
export const clipHash = (key: ClipKey): Promise<string | null> => sha256(
  [key.shaA, key.shaB, key.fingerprint, Math.fround(key.levels.a), Math.fround(key.levels.b), key.implementation].join('|'),
);

const bytesOf = (made: Pick<MadeSeam, 'rendered'>): number => made.rendered.channels.reduce((total, channel) => total + channel.byteLength, 0);

export function createClipStore(open: () => Promise<DerivedStore> = derivedStore, budget = CLIP_BUDGET_BYTES): ClipStore {
  let indexSha: Promise<string | null> | null = null;
  const indexKey = () => (indexSha ??= sha256('selectadj seam clip index'));
  const readIndex = async (store: DerivedStore, sha: string): Promise<Index> => (await store.get<Index>('clip', INDEX_VERSION, sha)) ?? { clips: [] };
  return {
    async get(key) {
      try {
        const [store, sha] = await Promise.all([open(), clipHash(key)]);
        if (!sha) return null;
        const kept = await store.get<Stored>('clip', CLIP_VERSION, sha);
        if (!kept?.rendered?.channels?.length) return null;
        const index = await indexKey();
        if (index) {
          const known = await readIndex(store, index);
          const entry = known.clips.find(([one]) => one === sha);
          if (entry) {
            entry[2] = Date.now();
            await store.put('clip', INDEX_VERSION, index, known);
          }
        }
        return {
          status: 'clip', rendered: kept.rendered, move: kept.move, option: kept.option, passed: kept.passed, nearMiss: kept.nearMiss, fellBack: kept.fellBack, beatsAligned: kept.beatsAligned === true,
          facts: { passed: kept.passed, failures: kept.failures.map(([name, value, limit, fix]) => ({ name, value, limit, fix })) },
          attempts: [], tookMs: 0, implementation: kept.rendered.implementation,
        };
      } catch {
        return null;
      }
    },
    async put(key, made) {
      try {
        const [store, sha, index] = await Promise.all([open(), clipHash(key), indexKey()]);
        const bytes = bytesOf(made);
        if (!sha || !index || bytes > budget) return;
        const stored: Stored = {
          rendered: made.rendered, move: made.move, option: made.option, passed: made.passed, nearMiss: made.nearMiss, fellBack: made.fellBack, beatsAligned: made.beatsAligned,
          failures: made.facts.failures.map((check) => [check.name, check.value, check.limit, check.fix]),
        };
        const known = await readIndex(store, index);
        const kept = known.clips.filter(([one]) => one !== sha);
        // least recently used first out, until the new clip fits the budget
        kept.sort((left, right) => left[2] - right[2]);
        let total = kept.reduce((sum, [, size]) => sum + size, 0);
        while (kept.length && total + bytes > budget) {
          const [gone, size] = kept.shift()!;
          total -= size;
          await store.delete('clip', CLIP_VERSION, gone);
        }
        if (!(await store.put('clip', CLIP_VERSION, sha, stored))) return;
        await store.put('clip', INDEX_VERSION, index, { clips: [...kept, [sha, bytes, Date.now()]] });
      } catch {
        // a clip that cannot be kept is made again next time
      }
    },
  };
}
