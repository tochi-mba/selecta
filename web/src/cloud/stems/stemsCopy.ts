import type { DownloadFailure, PauseReason, StemDegradeCode, StemMove, StemRefusalCode } from './types';

/** Every word the stems surfaces say, in one place, so the copy audit and the honesty rules can
 * read them all (ADR-0459). The rules: never say a stem move played unless it was scheduled; never
 * claim a quality; always say what happens instead when stems are not there. */

/** Sizes in the units a member reads: whole megabytes above ten, one decimal below. */
export function sizeWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'an unknown amount';
  const mb = bytes / 1_000_000;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** A whole percentage from 0..1, clamped. */
export const percentWords = (fraction: number) => `${Math.round(Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1) * 100)}%`;

export const STEMS_COPY = {
  title: 'Stems',
  pitch: 'Split songs into voice, drums, bass and melody on this device.',
  why: 'Vocal ride, strip and land, and intertwined stems need each song split into its parts. Without the splitter, transitions use moves that don’t need stems.',
  offerSize: (bytes: number, needBytes: number) => `The splitter is a ${sizeWords(bytes)} download and needs ${sizeWords(needBytes)} of storage on this device.`,
  metered: 'You seem to be on a metered or data-saver connection. The download may count against your data.',
  meteredUnknown: 'If you are on mobile data, the download may count against your data.',
  download: 'Download the splitter',
  downloading: 'Starting…',
  notNow: 'Not now',
  notNowShort: 'The splitter isn’t downloaded. Transitions use moves that don’t need stems.',
  progressLabel: 'Splitter download',
  progressValue: (received: number, total: number) => `${sizeWords(received)} of ${sizeWords(total)}`,
  downloadingLine: 'Downloading the splitter. It carries on from where it got to if you reload.',
  downloadPausedLine: 'Download paused. It carries on from where it got to when you resume.',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel download',
  downloadedToast: 'The stem splitter is ready on this device.',
  readyLine: (bytes: number) => `The splitter is on this device (${sizeWords(bytes)}). Stems are prepared ahead for transitions that use them.`,
  implementation: (how: string) => `It splits songs using ${how} on this device.`,
  remove: 'Remove the splitter',
  removing: 'Removing…',
  keep: 'Keep it',
  removeHint: 'Frees the space. Stems already prepared are removed too, and stem moves need the download again.',
  removed: (freed?: number) => (freed && freed > 0 ? `Removed. That freed ${sizeWords(freed)}.` : 'Removed.'),
  updated: 'There is a new version of the splitter. Stems will be prepared again with the new splitter.',
  tryAgain: 'Try again',
  tryingAgain: 'Trying again…',
  freeSpace: 'Free up space on this device',
  unsupportedTitle: (reason: string) => `This device can’t split songs into stems: ${reason}`,
  unsupportedAfter: 'Transitions use moves that don’t need stems.',
  crashRetry: 'Let this device try again',
  crashRetryHint: 'Splitting stopped this tab last time, so SelectaDJ stopped trying. Trying again may stop it again.',
  controller: 'Stems are prepared on the device playing the music. This device only shows what that one scheduled.',
  readyStatus: 'Ready',
  preparingTitle: 'Stems for upcoming transitions',
} as const;

export const DOWNLOAD_FAILED: Record<DownloadFailure, (detail?: string) => string> = {
  network: () => 'The download stopped because the connection dropped. Nothing was lost; it carries on from where it got to.',
  checksum: () => 'The downloaded file didn’t match what was expected, so it wasn’t kept. Downloading again usually fixes this.',
  storage_full: () => 'This device ran out of storage space for the splitter. Clearing cached audio in This device frees space.',
  other: (detail) => (detail ? `The download didn’t finish: ${detail.replace(/[.\s]*$/, '')}.` : 'The download didn’t finish.'),
};

export const SPLITTING_PAUSED: Record<PauseReason, string> = {
  hidden: 'Stems are prepared while this tab is open. Work picks up again when you come back to it.',
  battery: 'Splitting is paused while battery saver is on. Transitions use moves that don’t need stems until it can carry on.',
  thermal: 'Splitting is paused while this device cools down. Transitions use moves that don’t need stems until it can carry on.',
};

/** Listen: the notice while stems are still being prepared. */
export const TAB_NOTICE = 'Stems are prepared while this tab is open.';
export const TAB_NOTICE_RESUMED = 'Stems carry on being prepared now this tab is open again.';

/** Per-transition readiness, for the editor seam row and Listen Up next. */
export const READINESS = {
  queued: 'Stems for this transition are waiting to be prepared.',
  running: (fraction: number) => `Getting stems ready for this transition (${percentWords(steppedProgress(fraction))})`,
  ready: 'Stems are ready for this transition.',
  failed: (why: string) => `Splitting failed for this transition: ${trimSentence(why)}. It will use a move that doesn’t need stems.`,
  skipped: (why: string) => `No stems for this transition: ${trimSentence(why)}.`,
  paused: 'Getting stems ready is paused, so this transition may use a move that doesn’t need stems.',
} as const;

/** Progress in steps of ten, so a live region speaks a few times rather than on every tick. */
export function steppedProgress(fraction: number): number {
  const clamped = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
  return Math.floor(clamped * 10) / 10;
}

function trimSentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]*$/, '');
  return trimmed ? trimmed[0].toLowerCase() + trimmed.slice(1) : 'no reason recorded';
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]*$/, '');
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}.` : '';
}

/** The degraded reasons a schedule records when a stem move was wanted but a non-stem move was
 * scheduled. Each is a whole sentence, shown after "Scheduled here: Blend." */
export const STEM_DEGRADED: Record<StemDegradeCode, (detail?: string) => string> = {
  not_ready: () => 'The stems weren’t ready in time.',
  not_connected: () => 'The song isn’t connected on this device this visit, so it couldn’t be split.',
  split_failed: (detail) => (detail ? sentence(`Splitting failed: ${trimSentence(detail)}`) : 'Splitting failed.'),
};

/** The words for one degraded record, for the integrator to put in `SeamSchedule.degraded`. */
export const stemDegradedReason = (code: StemDegradeCode, detail?: string): string => STEM_DEGRADED[code](detail);

/** What each stem move needs that this pair did not have, finishing "Vocal ride needs ...". */
export const STEM_REFUSAL_NEEDS: Record<StemRefusalCode, string> = {
  tempo: 'two songs closer in tempo',
  grid: 'a steadier beat in both songs',
  room: 'more time before the next song starts',
  voice: 'a voice in the first song to ride over',
};

export const STEM_MOVE_LABELS: Record<StemMove, string> = {
  vocal_ride: 'Vocal ride',
  stem_arrange: 'Strip and land',
  stem_intertwine: 'Intertwined stems',
};

/** "Vocal ride needs two songs closer in tempo." `reason` may be a code or the recipe's own words. */
export function stemRefusal(move: StemMove, reason: StemRefusalCode | string): string {
  const needs = (STEM_REFUSAL_NEEDS as Record<string, string>)[reason] ?? trimSentence(reason);
  return `${STEM_MOVE_LABELS[move]} needs ${needs}.`;
}

/** Make a Mix shaping: the stem preference. */
/** Editor Move picker: the reasons a stem move is listed but can't be chosen, or needs a step. */
export const PICKER = {
  unavailable: (reason: string) => `This device can’t split songs into stems: ${reason}`,
  downloadNeeded: 'Needs the stem splitter, downloaded in More, This device.',
} as const;

/** Every fixed string and a sample of every built one, for the copy tests. */
export function allStemsCopy(): string[] {
  const sample = 'sample reason';
  const built = [
    STEMS_COPY.offerSize(120_000_000, 300_000_000),
    STEMS_COPY.progressValue(1_000_000, 2_000_000),
    STEMS_COPY.readyLine(120_000_000),
    STEMS_COPY.implementation('WebGPU'),
    STEMS_COPY.removed(5_000_000),
    STEMS_COPY.removed(),
    STEMS_COPY.unsupportedTitle(sample),
    ...Object.values(DOWNLOAD_FAILED).flatMap((words) => [words(), words(sample)]),
    READINESS.running(0.4),
    READINESS.failed(sample),
    READINESS.skipped(sample),
    ...Object.values(STEM_DEGRADED).flatMap((words) => [words(), words(sample)]),
    ...(Object.keys(STEM_MOVE_LABELS) as StemMove[]).flatMap((move) => (Object.keys(STEM_REFUSAL_NEEDS) as StemRefusalCode[]).map((code) => stemRefusal(move, code))),
    PICKER.unavailable(sample),
  ];
  const fixed = [
    ...(Object.values(STEMS_COPY) as unknown[]).filter((value): value is string => typeof value === 'string'),
    ...Object.values(SPLITTING_PAUSED),
    TAB_NOTICE,
    TAB_NOTICE_RESUMED,
    READINESS.queued,
    READINESS.ready,
    READINESS.paused,
    PICKER.downloadNeeded,
  ];
  return [...fixed, ...built];
}
