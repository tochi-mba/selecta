import { MixItem, Storage } from './api';

export const clock = (seconds: number | null | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds)) return '–:––';
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export const length = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} hr ${rest} min` : `${Math.floor(minutes / 60)} hr`;
};

export const gb = (bytes: number): string => {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? `${Math.round(value)} GB` : `${value.toFixed(1)} GB`;
};

/** How long the set really runs. Finished seams say exactly what they skip. Songs with no finished
 * seam yet are guessed at, since a set usually plays about two thirds of each one. */
export function runningTime(mix: MixItem[]): number {
  let total = 0;
  mix.forEach((item, index) => {
    const into = item.seam?.state;
    const out = mix[index + 1]?.seam?.state;
    const from = into?.status === 'ready' ? (into.b_source_end ?? 0) : index ? item.duration * 0.15 : 0;
    const to =
      out?.status === 'ready'
        ? (out.a_source_start ?? item.duration)
        : index + 1 < mix.length
          ? item.duration * 0.8
          : item.duration;
    total += Math.max(to - from, 0);
    if (out?.status === 'ready') total += out.duration ?? 0;
  });
  return total;
}

/** Plain words for the storage panel. Selecta's disk use comes in two kinds, and a person needs to
 * know which is which to understand what the slider does. */
export function storageWords(storage: Storage): { summary: string; detail: string } {
  const hundredths = (bytes: number) => Math.round((bytes / 1024 ** 3) * 100);
  const preciseGb = (value: number) => `${(value / 100).toFixed(2)} GB`;
  const used = hundredths(storage.used_bytes);
  const kept = hundredths(storage.kept_bytes);
  // Derive the displayed cache as the remainder so rounding can never make the parts
  // add up to a different displayed total.
  const cache = Math.max(used - kept, 0);
  return {
    summary: `Selecta is using ${preciseGb(used)}. Your drive has ${gb(storage.free_bytes)} free.`,
    detail:
      `${preciseGb(cache)} of that is separated vocals and finished seams, which Selecta can make again. ` +
      `The other ${preciseGb(kept)} is saved data and models, including analysis, transition history, backups and listening studies.`,
  };
}

/** What the current seam state means, in words. */
export function seamStatusWords(status: string, passed?: boolean): string {
  switch (status) {
    case 'ready':
      return passed ? 'Ready' : 'Ready, with a warning';
    case 'failed':
      return 'Can’t do this one';
    case 'none':
    case 'queued':
      return 'Waiting to render';
    default:
      return 'Rendering…';
  }
}

export const SET_LENGTHS = [
  { label: '30 min', songs: 12 },
  { label: '1 hour', songs: 24 },
  { label: '2 hours', songs: 48 },
];

const RESUME_KEY = 'selecta-now';

export type Resume = { songId: number; position: number; time: number };

export function saveResume(resume: Resume) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(resume));
  } catch {
    /* no storage just means no resume */
  }
}

export function loadResume(mix: MixItem[]): Resume | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const resume = JSON.parse(raw) as Resume;
    const item = mix[resume.position];
    if (item?.song_id !== resume.songId) return null;
    if (resume.time < item.duration - 1) return resume;
    const next = mix[resume.position + 1];
    return next ? { songId: next.song_id, position: resume.position + 1, time: 0 } : null;
  } catch {
    return null;
  }
}

/** What a song's button says while it waits to be analysed. */
export function analysingWords(line: number[], songId: number): string {
  const place = line.indexOf(songId);
  if (place < 0) return 'Analyse now';
  return place === 0 ? 'Analysing…' : `Waiting, ${place} ahead`;
}

export function askedToAnalyse(title: string | null, ahead: number): string {
  const name = title ?? 'That song';
  if (ahead === 0) return `Analysing ${name}. It’s usually ready in about a minute.`;
  return `${name} is in line, with ${ahead} ahead of it.`;
}

/** Moves that couldn't work on a seam, one line per reason, so nothing is said three times. */
export function triedWords(tried: { move: string; why: string }[], names: Record<string, string>): string[] {
  const byReason = new Map<string, string[]>();
  for (const { move, why } of tried) {
    const reason = why.trim().replace(/\.+$/, '');
    byReason.set(reason, [...(byReason.get(reason) ?? []), names[move] ?? move]);
  }
  return [...byReason].map(([reason, moves]) => {
    const list = moves.length > 1 ? `${moves.slice(0, -1).join(', ')} and ${moves.at(-1)}` : moves[0];
    return `${list} couldn’t work here. ${reason}.`;
  });
}
