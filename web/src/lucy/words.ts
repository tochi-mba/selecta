import type { StatusKind } from '../ui/controls';
import type { CardStatus, RunState, When } from './types';

/** The plain words Lucy's pages use, in one place, so the same state is always said the same way and
 * nothing is ever claimed that the data doesn't say. Unknown is always said as "unknown". */

export const RUN_WORDS: Record<RunState, string> = {
  interpreting: 'Reading your request',
  running_tools: 'Working through the steps',
  evaluating: 'Checking the plan',
  preparing: 'Putting the proposal together',
  streaming: 'Replying',
  awaiting_user: 'Waiting for you',
  awaiting_permission: 'Waiting for your OK',
  interrupted: 'Interrupted',
  failed: 'Stopped: something went wrong',
  completed: 'Done',
  cancelled: 'Stopped',
  superseded: 'Replaced by a newer request',
};

export const CARD_WORDS: Record<CardStatus, { words: string; kind: StatusKind }> = {
  queued: { words: 'Waiting', kind: 'queued' },
  running: { words: 'Working', kind: 'working' },
  progress: { words: 'Working', kind: 'working' },
  completed: { words: 'Done', kind: 'ready' },
  failed: { words: 'Didn’t work', kind: 'failed' },
  skipped: { words: 'Skipped', kind: 'unavailable' },
  cancelled: { words: 'Stopped', kind: 'unavailable' },
  retrying: { words: 'Trying again', kind: 'recovering' },
};

/** What a transition in the readiness ledger is, in words. */
export function seamWords(status: string, verified = false): { words: string; kind: StatusKind } {
  switch (status) {
    case 'already_rendered':
    case 'ready':
      return verified
        ? { words: 'Ready to play', kind: 'ready' }
        : { words: 'Rendered, not verified on disk', kind: 'warning' };
    case 'queued': return { words: 'In line to render', kind: 'queued' };
    case 'rendering': return { words: 'Rendering', kind: 'working' };
    case 'failed': return { words: 'Failed', kind: 'failed' };
    case 'none': return { words: 'Not rendered yet', kind: 'planned' };
    case 'gone':
    case 'missing':
    case 'stale':
    case 'lost':
      return { words: 'Was ready before - gone now', kind: 'warning' };
    default:
      return { words: 'Unknown', kind: 'unavailable' };
  }
}

export const isReadyStatus = (status: string) => status === 'ready' || status === 'already_rendered';

export function toDate(value: When | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Today, 14:05", "Yesterday" or a date, for lists. */
export function whenWords(value: When | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay(date, now)) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function durationWords(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return 'under a second';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** `share_lyrics` reads as "Share lyrics". */
export function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Any value from the server, as short text. Missing values are "unknown", never blank or a guess. */
export function valueWords(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'unknown';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : 'unknown';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(valueWords).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return 'unknown';
  }
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Readable song facts, with "unknown" wherever there's no value. */
export function bpmWords(bpm: number | null | undefined) {
  return typeof bpm === 'number' && Number.isFinite(bpm) ? `${Math.round(bpm)} BPM` : 'BPM unknown';
}
export function keyWords(key: string | null | undefined) {
  return key ? `Key ${key}` : 'Key unknown';
}
export function energyWords(energy: number | null | undefined) {
  if (typeof energy !== 'number' || !Number.isFinite(energy)) return 'Energy unknown';
  return `Energy ${energy <= 1 ? Math.round(energy * 100) / 100 : Math.round(energy)}`;
}

/** How far apart two keys are, said without music theory. */
export function keyDistanceWords(distance: number | null | undefined): string {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) return 'How well the keys sit together: unknown';
  if (distance === 0) return 'Same key';
  if (distance === 1) return 'Keys sit well together';
  return distance <= 2 ? 'Keys are a little apart' : 'Keys are far apart';
}

export function tempoGapWords(gap: number | null | undefined): string {
  if (typeof gap !== 'number' || !Number.isFinite(gap)) return 'Tempo difference: unknown';
  const rounded = Math.round(Math.abs(gap) * 10) / 10;
  return rounded === 0 ? 'Same tempo' : `Tempo differs by ${rounded} BPM`;
}

/** "2 added, 1 moved, 8 kept", leaving out what didn't happen. */
export function countsWords(counts: Partial<Record<'added' | 'replaced' | 'moved' | 'removed' | 'kept', number>> | null | undefined): string {
  if (!counts) return '';
  const parts = (['added', 'replaced', 'moved', 'removed', 'kept'] as const)
    .filter((name) => typeof counts[name] === 'number' && (counts[name] ?? 0) > 0)
    .map((name) => `${counts[name]} ${name}`);
  return parts.length ? parts.join(', ') : 'No songs changed';
}

export const EXAMPLE_PROMPTS = [
  '12 songs that build up slowly',
  'Only transitions that are already ready to play',
  'An hour of Afrobeats, no repeats',
];
