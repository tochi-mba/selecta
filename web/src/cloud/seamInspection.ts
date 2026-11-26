import type { MixData, Request, SeamOptions, SeamState } from '../api';
import type { MadeSeam } from '../dsp/render/seamMaker';
import { encodeWav } from '../engine/wav';
import { BROWSER_MOVE_WORDS, browserMoveNames } from './browserMoves';
import { deviceRenderOn, type Booked } from './deviceStudio';
import { moveName } from './hosted/hostedWords';
import { reportingOn, seamKey, thisDevice } from './seamReports';
import { prepareRequestSeams, studioOf } from './studioWiring';

/** The Seam Inspector for a transition the account planned and this device made
 * (T-20261126-827e; docs/engineering/cloud-device-features.md).
 *
 * The shared inspector reads a seam's state from the mix (`GET /mix`) and plays its preview. Here
 * the state comes from what this device holds: the clip its studio made or kept in this visit,
 * the planner's answer it was made from (the move, its bars and reasons), the checks the finished
 * audio was measured on and the other moves tried. The preview is that very clip, played from
 * memory, and Good or Bad goes to the account under the key the seam was reported with. A
 * transition this device has not made can be asked for ("Render it"), and the studio makes it
 * after the music's own. With `cloud.device_render` and `cloud.brain` off, nothing here answers. */

export const inspectorOn = (): boolean => deviceRenderOn() && reportingOn();

/** What each audit check is called, passed and not (src/selecta/seam_kinds.py CHECK_WORDS). */
export const CHECK_WORDS: Record<string, [string, string]> = {
  'beat alignment': ['Beats line up', 'Beats drift apart'],
  'vocal overlap': ['Vocals take turns', 'Two voices clash'],
  'phrase integrity': ['Nothing cut mid-line', 'A line gets cut off'],
  'quiet time': ['No gap in the sound', 'There’s a quiet gap'],
  'entry level': ['B doesn’t jump out', 'B comes in too loud'],
  'level fall': ['The level holds up', 'The level drops after the seam'],
  'low end clash': ['Clean low end', 'Two bass lines fight'],
  harmony: ['Keys sit together', 'The keys clash'],
  'true peak': ['No clipping', 'It clips'],
  stretch: ['Tempo change is gentle', 'Tempo is stretched too far'],
};

const sentence = (text: string) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);

/** A take that did not become the clip, in the words the inspector lists. */
function whyNot(take: MadeSeam['attempts'][number]): string {
  if (take.skipped) return sentence(take.skipped);
  const failed = take.facts?.failures[0];
  if (failed) return CHECK_WORDS[failed.name]?.[1] ?? sentence(failed.name);
  return 'Another move sounded better';
}

/** The seam's state as the Desktop's `GET /mix` gives it, from this device's clip. */
export function inspectedState(booked: Booked, key: string, rating?: string | null): SeamState {
  const { made, answer } = booked;
  const entry = made.option === 'fallback' ? answer.fallback : answer.options?.find((one) => one.index === made.option);
  const rate = made.rendered.sampleRate;
  const failures = made.facts.failures;
  const checks = failures.length
    ? failures.map((failed) => ({ name: failed.name, passed: false, text: CHECK_WORDS[failed.name]?.[1] ?? sentence(failed.name), value: `${failed.value}` }))
    : [{ name: 'every check', passed: true, text: 'Every check on the finished audio passed', value: '' }];
  const tried = made.attempts.filter((take) => take.option !== made.option).map((take) => ({ move: take.move, why: whyNot(take) }));
  const reasons = (entry?.reasons ?? []).filter((one) => typeof one === 'string' && one.trim());
  return {
    status: 'ready',
    key,
    label: moveName(made.move),
    style: made.move,
    ...(reasons.length ? { why: sentence(reasons.join(', ')) } : {}),
    passed: made.passed,
    fell_back: made.fellBack,
    bars: entry?.option.bars,
    a_source_start: made.rendered.aStartSample / rate,
    b_source_end: made.rendered.bEndSample / rate,
    duration: made.rendered.channels[0].length / rate,
    tried,
    checks,
    ...(rating ? { rating } : {}),
  };
}

// one preview per clip, played from memory; the oldest let go past this many
const PREVIEWS_KEPT = 8;
const previews = new Map<string, string>();

/** The clip as a WAV in memory, for the inspector's player. Never sent anywhere. */
export function previewUrl(key: string, made: MadeSeam): string | null {
  const kept = previews.get(key);
  if (kept) return kept;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const channels = made.rendered.channels;
  const wav = encodeWav([{ numberOfChannels: channels.length, length: channels[0].length, sampleRate: made.rendered.sampleRate, getChannelData: (channel) => channels[channel] }]);
  const url = URL.createObjectURL(new Blob([wav.bytes as BlobPart], { type: 'audio/wav' }));
  previews.set(key, url);
  while (previews.size > PREVIEWS_KEPT) {
    const [oldest, gone] = previews.entries().next().value as [string, string];
    previews.delete(oldest);
    URL.revokeObjectURL(gone);
  }
  return url;
}

// the account's Good and Bad for the keys last asked, read again when they change, after a
// rating, or once this long has passed: the mix is read far more often than a seam is rated
const RATINGS_FRESH_MS = 30_000;
let ratingsKept: { keys: string; at: number; ratings: Map<string, string | null> } | null = null;
/** A rating was given here: the next read asks the account again. */
export const forgetRatings = (): void => { ratingsKept = null; };

async function ratingsOf(keys: string[], workspaceId: string, cloud: Request): Promise<Map<string, string | null>> {
  const asked = keys.join(',');
  if (ratingsKept && ratingsKept.keys === asked && Date.now() - ratingsKept.at < RATINGS_FRESH_MS) return ratingsKept.ratings;
  const ratings = new Map<string, string | null>();
  try {
    const device = thisDevice(workspaceId);
    const answer = await cloud<{ seams?: { key: string; rating?: string | null }[] }>(`/seams?keys=${asked}${device ? `&device_id=${encodeURIComponent(device)}` : ''}`);
    for (const seam of answer.seams ?? []) ratings.set(seam.key, seam.rating ?? null);
    ratingsKept = { keys: asked, at: Date.now(), ratings };
  } catch {
    // shown without its Good or Bad; rating it still works
  }
  return ratings;
}

/** The mix with each transition this device holds a clip for shown as made, with its checks,
 * reasons, other moves tried and its preview. Ratings are read from the account in one request. */
export async function withInspection(mix: MixData, workspaceId: string, cloud: Request): Promise<MixData> {
  const studio = inspectorOn() ? studioOf(workspaceId) : null;
  if (!studio || mix.mix.length < 2) return mix;
  const found = await Promise.all(mix.mix.map(async (item, at) => {
    const before = mix.mix[at - 1];
    const booked = at > 0 && item.seam ? studio.madeFor(before.song_id, item.song_id) : null;
    if (!booked?.answer.fingerprint) return null;
    return { at, booked, key: await seamKey(before.song_id, item.song_id, booked.answer.fingerprint, booked.made.option) };
  }));
  const held = found.filter((one): one is NonNullable<typeof one> => one !== null);
  if (!held.length) return mix;
  const ratings = await ratingsOf(held.map((one) => one.key), workspaceId, cloud);
  const items = mix.mix.map((item) => ({ ...item }));
  for (const { at, booked, key } of held) {
    const item = items[at];
    const state = inspectedState(booked, key, ratings.get(key));
    const url = previewUrl(key, booked.made);
    item.seam = { ...item.seam!, state: { ...state, ...(url ? { preview_url: url } : {}) } };
  }
  return { ...mix, mix: items };
}

/** "Render it" in the inspector: the studio makes this transition after the music's own. */
export async function askToMake(workspaceId: string, mix: MixData, position: number): Promise<{ queued: boolean }> {
  const before = mix.mix[position - 1];
  const item = mix.mix[position];
  if (!before || !item) return { queued: false };
  return { queued: (await prepareRequestSeams(workspaceId, [{ a: before.song_id, b: item.song_id }], 'inspector')) > 0 };
}

/** The inspector's Change tab: the moves a browser mix can ask for, with nothing the app's own
 * transition maker offers on top (exits, entries and lengths are its, and Stem Studio is absent). */
export function seamOptions(): SeamOptions {
  const names = browserMoveNames();
  return {
    moves: Object.entries(names).map(([name, label]) => ({ name, label, description: BROWSER_MOVE_WORDS[name as keyof typeof BROWSER_MOVE_WORDS]?.about ?? '', available: true, reason: null })),
    exits: [],
    entries: [],
    lengths: [],
    studio: { available: false, reason: 'Stem Studio works in the SelectaDJ app on a computer.' },
    links: [],
    tempo_gap: 0,
    keys: [],
  };
}
