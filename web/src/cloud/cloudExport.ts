import type { RenderedClip } from '../dsp/seams';
import { bytesSha256 } from '../media/identity';
import type { Request } from './accountFacts';
import { askOnce, askPair, clipFrom, cloudPairsOf, cloudSeamsOn, gainOf, LINK_FRESH_MS, type AskDeps, type CloudPair, type MixSong, type SeamAnswer } from './cloudSeams';
import { browserConnection, type ConnectionLike } from './studioPlan';

/** Saving a mix as a file with its transitions made in the cloud (cloud.studio_seams), joined
 * as playback joins them: each cloud seam of the file's songs is asked for on the standard lane
 * and waited for (bounded as playback's asks are), its clip decoded by the export's own decode,
 * and each song next to a ready clip is read from its lossless file at the clip's level. A seam
 * that is not ready, refused or used up joins as before. Nothing from this device is sent. */

type Decoded = { length?: number; duration: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };

export type CloudExportParts = {
  /** Song `index` of the file from its lossless file, at its level. */
  songs: Map<number, { data: () => Promise<ArrayBuffer>; level: number }>;
  /** The clip from song `index` into the next. */
  clips: Map<number, RenderedClip>;
};

export type CloudExportDeps = AskDeps & {
  request: Request;
  /** Of these song ids, those with their own cloud copy. */
  inCloud: (songIds: readonly number[]) => Promise<ReadonlySet<number>>;
  decode: (bytes: ArrayBuffer) => Promise<Decoded>;
  /** Each song's usual bytes, read when its lossless file cannot be had after all. */
  usual: (index: number) => Promise<ArrayBuffer>;
  connection?: ConnectionLike;
};

const NOTHING: CloudExportParts = { songs: new Map(), clips: new Map() };

/** A sleep a cancel ends at once. */
const sleeper = (signal: AbortSignal) => (ms: number) => new Promise<void>((done) => {
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true });
});

export async function cloudExportParts(items: readonly MixSong[], deps: CloudExportDeps, signal: AbortSignal): Promise<CloudExportParts> {
  if (!cloudSeamsOn()) return NOTHING;
  const pairs = await cloudPairsOf(items, deps.inCloud, { device: false, connection: deps.connection ?? browserConnection() });
  if (!pairs.some(Boolean)) return NOTHING;
  const ask: AskDeps = { ...deps, sleep: deps.sleep ?? sleeper(signal) };
  const now = deps.now ?? Date.now;
  const parts: CloudExportParts = { songs: new Map(), clips: new Map() };
  const done = await Promise.all(pairs.map(async (pair, index) => {
    if (!pair) return null;
    const asked = await askPair(pair, 'standard', ask, signal).catch(() => null);
    if (!asked || 'declined' in asked) return null;
    const audio = await deps.decode(asked.bytes).catch(() => null);
    const clip = audio ? clipFrom(audio, asked.ready) : null;
    return clip ? { index, pair, clip, answer: asked.ready as SeamAnswer, at: now() } : null;
  }));
  for (const made of done) {
    if (!made) continue;
    parts.clips.set(made.index, made.clip);
    // a song between two clips takes the first one's file and level; a second clip at another
    // level is refused at its join and crossfades, as playback's would
    for (const [side, at] of [['a', made.index], ['b', made.index + 1]] as const) {
      if (!parts.songs.has(at)) parts.songs.set(at, lossless(made.pair, made.answer, made.at, side, at, ask, deps));
    }
  }
  return parts;
}

function lossless(pair: CloudPair, answer: SeamAnswer, at: number, side: 'a' | 'b', index: number, ask: AskDeps, deps: CloudExportDeps) {
  const file = answer.files![side]!;
  const level = gainOf(side === 'a' ? answer.levels!.a_gain_db : answer.levels!.b_gain_db);
  const fetchBytes = ask.fetchBytes ?? (async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('SelectaDJ could not fetch this from your cloud library.');
    return response.arrayBuffer();
  });
  return {
    level,
    data: async () => {
      try {
        // a link asked for long ago is signed again first
        const url = (ask.now ?? Date.now)() - at < LINK_FRESH_MS ? file.url : (await askOnce(ask, pair, 'standard')).files?.[side]?.url ?? file.url;
        const bytes = await fetchBytes(url);
        if (await (ask.sha256 ?? bytesSha256)(bytes) === file.sha256) return bytes;
      } catch {
        // read the usual way below
      }
      return deps.usual(index);
    },
  };
}
