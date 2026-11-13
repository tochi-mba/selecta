// Staff quick-control copy (ADR-0453 D10, S4). S4 can sit on a bar where customers see it, so
// nothing here names plans, money, licences, seats or pilots; the one manager line lives in
// MANAGER_COPY (states.ts) and only managers see it (D4). Plain words, no blame, no
// exclamation marks, SelectaDJ.

import type { ZoneCommand } from '../client';

export type SteerWord = 'bigger' | 'calmer' | 'something_else';

export const STEER_LABEL: Record<SteerWord, string> = {
  bigger: 'Bigger',
  calmer: 'Calmer',
  something_else: 'Something else',
};

export const STAFF_COPY = {
  pageLabel: 'Music controls',
  zonesLabel: 'Zone',
  chooseZone: 'Choose a zone',
  now: 'Now',
  next: 'Next',
  nothingNext: 'Next song is being chosen',
  nothingNow: 'Nothing playing right now',
  progress: 'Song progress',
  deckLabel: 'Change the music',
  skip: 'Skip',
  pause: 'Pause',
  resume: 'Resume',
  requests: 'Requests',
  volume: 'Volume',
  noZones: "This tablet isn't set up for a zone yet. Ask your manager",
  noRequests: 'No requests right now',
  loading: 'Getting the music',
  offlineQueued: 'Will send when back online',
  degraded: 'Changes may take a few seconds',
  stillPausedTitle: 'Still paused',
  stillPausedBody: 'Still paused. Resume the music or keep it paused?',
  keepPaused: 'Keep it paused',
  resumeMusic: 'Resume the music',
  approve: 'Approve',
  pass: 'Pass',
  requestsTitle: 'Requests',
  close: 'Close',
  playHere: 'Play here instead',
  playHereConfirm: 'Play here',
  cancel: 'Cancel',
  pinTitle: 'Enter your PIN',
  pinHelp: 'Enter your staff PIN to keep going',
  pinWrong: "That PIN didn't match. Try again",
  pinBack: 'Back one digit',
  pinGo: 'Go',
  pinShown: (count: number) => (count ? `${count} digit${count === 1 ? '' : 's'} entered` : 'No digits entered'),
  thisTablet: 'this tablet',
  tooLateToUndo: 'Too late to undo that',
  sentWhenBack: (count: number) => `Sent ${count} waiting ${count === 1 ? 'change' : 'changes'}`,
} as const;

export function queuedWords(count: number): string {
  return `${STAFF_COPY.offlineQueued}. ${count} waiting`;
}

export function capWords(cap: number): string {
  return `Up to ${cap} here`;
}

export function volumeValueText(level: number, cap: number): string {
  return `${level} of ${cap}, the most allowed here`;
}

export function requestsLabel(count: number): string {
  return `${STAFF_COPY.requests} ${count}`;
}

export function stayLateWords(until: string): string {
  return `Keep the music on until ${until}`;
}

export function stayingLateWords(until: string): string {
  return `Music stays on until ${until}`;
}

export function silentWords(zone: string): string {
  return `${zone} is silent. Check the player is on`;
}

export function notTodayWords(zone: string): string {
  return `${zone} isn't playing today`;
}

export function pausedByWords(who: string): string {
  return `Paused by ${who}`;
}

export function playHereQuestion(zone: string): string {
  return `Play ${zone} music from this tablet? The ${zone} player will stop.`;
}

export function waitedWords(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'Waiting under a minute';
  return `Waiting ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function votesWords(votes: number): string {
  return `${votes} vote${votes === 1 ? '' : 's'}`;
}

export function requestedBy(nickname: string): string {
  return `Asked by ${nickname}`;
}

/** The word a command reads as in "That skip was too late" and in toasts. */
export function commandWord(command: ZoneCommand): string {
  switch (command.kind) {
    case 'skip': return 'skip';
    case 'steer': return STEER_LABEL[command.word];
    case 'pause': return 'pause';
    case 'resume': return 'resume';
    case 'volume': return 'volume change';
    case 'undo': return 'undo';
    case 'play_here': return 'Play here';
    case 'test': return 'test';
  }
}

export function tooLateWords(command: ZoneCommand): string {
  return `That ${commandWord(command)} was too late, so we didn't send it`;
}

/** The toast after a command; skip and steering carry Undo (D10). */
export function doneWords(command: ZoneCommand): string {
  switch (command.kind) {
    case 'skip': return 'Skipped.';
    case 'steer': return `${STEER_LABEL[command.word]} coming up.`;
    case 'pause': return 'Paused.';
    case 'resume': return 'Playing again.';
    case 'volume': return `Volume ${command.level}.`;
    case 'undo': return 'Undone.';
    default: return 'Done.';
  }
}
