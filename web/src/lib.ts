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
      return 'Not rendered yet';
    case 'queued':
      return 'In line';
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

export function askedToAnalyse(title: string | null, ahead: number, seconds?: number): string {
  const name = title ?? 'That song';
  const wait = seconds === undefined ? '' : ` Ready in ${etaWords(seconds)}.`;
  if (ahead === 0) return `Analysing ${name}.${wait || ' It’s usually ready in about a minute.'}`;
  return `${name} is in line, with ${ahead} ahead of it.${wait}`;
}

/** A wait in words. Precise enough to plan around, and never more precise than the estimate is. */
export function etaWords(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds < 15) return 'a few seconds';
  if (seconds < 45) return 'under a minute';
  if (seconds < 90) return 'about a minute';
  const minutes = seconds / 60;
  if (minutes < 10) return `about ${Math.round(minutes)} minutes`;
  if (minutes < 55) return `about ${Math.round(minutes / 5) * 5} minutes`;
  if (minutes < 90) return 'about an hour';
  return `about ${Math.round(minutes / 30) / 2} hours`;
}

/** The same, saying so when the honest answer is a range or the job has run long. */
export function etaRangeWords(eta: { seconds: number; low: number; high: number; late?: boolean } | undefined): string {
  if (!eta) return '';
  if (eta.late) return 'taking longer than usual';
  const wide = eta.seconds >= 120 && eta.low > 0 && eta.high / eta.low > 2.5;
  if (!wide) return etaWords(eta.seconds);
  const low = Math.round(eta.low / 60);
  const high = Math.round(eta.high / 60);
  if (high < 90) return `${Math.max(low, 1)} to ${high} minutes`;
  return `${Math.round(eta.low / 1800) / 2} to ${Math.round(eta.high / 1800) / 2} hours`;
}

/** What's left to analyse, in a sentence, including waiting for the mix. */
export function analysisWords(analysis: { seconds: number; low: number; high: number; after_mix: boolean } | undefined): string {
  if (!analysis) return 'It runs in the background.';
  const wait = etaRangeWords(analysis);
  return analysis.after_mix
    ? `It’ll be done in ${wait}, since it waits for rendering to finish first.`
    : `It takes ${wait} in the background.`;
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

export function nth(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${['th', 'st', 'nd', 'rd'][place % 10] ?? 'th'}`;
}

/** Where a draft has got to, in a few words. */
export function draftWords(draft: {
  songs: number;
  seams: number;
  ready: number;
  failed: number;
  waiting: number;
  rendering: boolean;
  place: number | null;
  eta: { seconds: number; low: number; high: number; late?: boolean } | null;
}): string {
  if (draft.songs === 0) return 'Empty';
  if (draft.seams === 0) return 'Add one more song';
  if (draft.waiting === 0) {
    if (draft.failed === 0) return 'Ready to play';
    return `${draft.ready} of ${draft.seams} ready, ${draft.failed} couldn’t be made`;
  }
  const done = `${draft.ready} of ${draft.seams} ready`;
  if (draft.place === null) return done;
  const wait = etaRangeWords(draft.eta ?? undefined);
  return draft.rendering ? `Rendering now. ${done}, ${wait} left` : `${done}. All ready in ${wait}`;
}

/** How far out time estimates have really been lately, once there's enough to say. */
export function estimateWords(accuracy: { jobs: number; typical_miss: number | null } | undefined): string {
  if (!accuracy || accuracy.jobs < 5 || accuracy.typical_miss === null) return '';
  const percent = Math.round((accuracy.typical_miss - 1) * 100);
  if (percent < 10) return 'Time estimates have been close lately.';
  return `Time estimates have typically been out by about ${percent}% lately, and they keep learning.`;
}
