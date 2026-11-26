import { auditFactsToJson } from '../dsp/render/repair';
import type { MadeSeam } from '../dsp/render/seamMaker';
import { flagListed } from '../flags';
import type { Request } from './accountFacts';
import type { CandidatesAnswer } from './deviceStudio';

/** Telling the account about each transition this device rendered (cloud.device_render and
 * cloud.brain; docs/engineering/engine-store-seams.md).
 *
 * When the studio accepts a clip, the account is told what was made: the two songs, the planner's
 * answer and option, the move, the audit's verdict, who rendered it and the clip's length and
 * hash. Never the clip, never a path or a file name. It goes in the background, after the clip is
 * in hand, so playback never waits on it, and once per seam: a key sent is remembered on this
 * device. Another device then sees the seam exists and renders its own; only the device holding a
 * clip may play it. */

export const reportingOn = (): boolean => flagListed('cloud.device_render') && flagListed('cloud.brain');

/** Keys remembered as sent, per workspace; the oldest are let go past this many. */
export const SENT_KEPT = 500;
const SENT_KEY = (workspaceId: string) => `selecta.seams.reported.${workspaceId}`;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The seam's key, as the account works it out (`cloud_brain.seams_routes.device_seam_key`). */
export async function seamKey(a: number, b: number, fingerprint: string, option: number | 'fallback'): Promise<string> {
  const text = new TextEncoder().encode(`${a}>${b}|${fingerprint}|${option}`);
  return hex(await crypto.subtle.digest('SHA-256', text)).slice(0, 20);
}

/** The SHA-256 of the clip's samples as rendered, channel after channel: it names this clip
 * without sending it. */
export async function clipHash(channels: readonly Float32Array[]): Promise<string> {
  const total = channels.reduce((sum, channel) => sum + channel.byteLength, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const channel of channels) {
    joined.set(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength), at);
    at += channel.byteLength;
  }
  return hex(await crypto.subtle.digest('SHA-256', joined));
}

function sentKeys(workspaceId: string): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(SENT_KEY(workspaceId)) ?? '[]');
    return Array.isArray(kept) ? kept.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function noteSent(workspaceId: string, key: string): void {
  try {
    const kept = [...sentKeys(workspaceId).filter((one) => one !== key), key].slice(-SENT_KEPT);
    localStorage.setItem(SENT_KEY(workspaceId), JSON.stringify(kept));
  } catch {
    // without storage it may be sent again next time, which the account takes as the same seam
  }
}

/** This browser's playback device id, when it has registered (usePlaybackDevice keeps it). */
export function thisDevice(workspaceId: string): string | null {
  try { return localStorage.getItem(`selecta.device.${workspaceId}`); } catch { return null; }
}

type Pair = { a: number; b: number };

/** The report for one made clip: every field the account keeps, and nothing else. */
export async function seamReport(made: MadeSeam, pair: Pair, answer: CandidatesAnswer, deviceId: string) {
  const entry = made.option === 'fallback' ? answer.fallback : answer.options?.find((one) => one.index === made.option);
  const option = entry?.option;
  const rate = made.rendered.sampleRate;
  const seconds = made.rendered.channels[0].length / rate;
  return {
    device_id: deviceId,
    a: pair.a,
    b: pair.b,
    fingerprint: answer.fingerprint as string,
    option: made.option,
    move: made.move,
    bars: option?.bars ?? 0,
    exit_bar: option ? option.exit_cue[0] : null,
    entry_bar: option ? option.entry_cue[0] : null,
    a_source_start: made.rendered.aStartSample / rate,
    b_source_end: made.rendered.bEndSample / rate,
    passed: made.passed,
    near_miss: made.nearMiss,
    fell_back: made.fellBack,
    audit: auditFactsToJson(made.facts),
    tried: Math.min(made.attempts.length, 64),
    implementation: made.implementation,
    clip_sha256: await clipHash(made.rendered.channels),
    clip_seconds: seconds,
  };
}

/** Tell the account about a clip this device made, once. Never throws and never waits on the
 * account for anything the music needs; a failure is tried again the next time the seam is made
 * or kept. Returns the key when it was sent. */
export async function reportSeam(request: Request, workspaceId: string, made: MadeSeam, pair: Pair, answer: CandidatesAnswer): Promise<string | null> {
  try {
    const deviceId = thisDevice(workspaceId);
    if (!reportingOn() || !deviceId || !answer.fingerprint) return null;
    const key = await seamKey(pair.a, pair.b, answer.fingerprint, made.option);
    if (sentKeys(workspaceId).includes(key)) return null;
    const body = await seamReport(made, pair, answer, deviceId);
    await request(`/seams/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    noteSent(workspaceId, key);
    return key;
  } catch {
    return null;
  }
}
