import { useEffect } from 'react';
import { announce } from '../ui/controls';
import { importSnapshot, subscribeImport, type ImportSnapshot } from './importSession';
import type { ImportSummary } from '../media';

/** The one voice of an import for screen readers (W4 overhaul): it speaks at milestones only,
 * never per file. Started, each quarter of the way, then finished (or paused, or failed). However
 * many surfaces show the import (Connect Music, the banner chip, onboarding), each milestone is
 * said once, because the memory of what was said lives here, not in any one of them. */

export type Milestone = { key: string; words: string };

/** What an import's numbers say in words. Shared with Connect Music's own summary line. */
export function importSummaryWords(summary: ImportSummary): string {
  const parts = [`${summary.imported} ${summary.imported === 1 ? 'song' : 'songs'} connected`];
  if (summary.duplicates) parts.push(`${summary.duplicates} already in your library`);
  if (summary.failed) parts.push(`${summary.failed} could not be read`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped as not music`);
  const words = parts.join(', ');
  if (summary.cancelled) return `Stopped. ${words} before you cancelled. Nothing else changed.`;
  if (summary.paused) return `Paused because browser storage is full. ${words} so far.`;
  return `${words}.`;
}

/** The milestone this snapshot has reached, or null when there is nothing new to say. Pure:
 * `run` counts imports so a second import's "started" is news again. */
export function milestoneOf(live: ImportSnapshot, run: number): Milestone | null {
  if (live.phase === 'running') {
    // `checked` is counted by the journalled import (cloud.resilient_import); else what landed
    const checked = live.checked ?? live.registered + live.failures.length;
    if (live.elsewhere) return { key: `${run}:elsewhere`, words: 'Another tab is importing your music. Progress shows here too.' };
    if (live.waiting?.why === 'offline') return { key: `${run}:wait:offline`, words: 'You are offline. Checking your music carries on when the connection is back.' };
    if (live.waiting?.why === 'server') return { key: `${run}:wait:server`, words: 'SelectaDJ’s service is not answering. The import keeps trying by itself.' };
    if (live.waiting?.why === 'signin') return { key: `${run}:wait:signin`, words: 'Sign in again to carry on. Your import is kept.' };
    if (typeof live.total !== 'number' || live.total <= 0) return { key: `${run}:started`, words: 'Checking your music has started.' };
    const quarter = Math.min(3, Math.floor((checked / live.total) * 4));
    if (quarter === 0) return { key: `${run}:started`, words: 'Checking your music has started.' };
    return { key: `${run}:q${quarter}`, words: `Checking your music: ${quarter * 25} percent done, ${checked} of ${live.total}.` };
  }
  if (live.phase === 'finished' && live.summary) return { key: `${run}:end`, words: `Checking your music finished. ${importSummaryWords(live.summary)}` };
  if (live.phase === 'paused') return { key: `${run}:end`, words: 'Checking your music paused: browser storage is full. Everything checked so far is in your library.' };
  if (live.phase === 'failed') return { key: `${run}:end`, words: `Checking your music stopped. ${live.error ?? 'Anything already checked is in your library.'}` };
  return null;
}

let watchers = 0;
let unsubscribe: (() => void) | null = null;
let run = 0;
let lastPhase: ImportSnapshot['phase'] = 'idle';
const said = new Set<string>();

function hear() {
  const live = importSnapshot();
  if (live.phase === 'running' && lastPhase !== 'running') run += 1;
  lastPhase = live.phase;
  const milestone = milestoneOf(live, run);
  if (!milestone || said.has(milestone.key)) return;
  // a quarter skipped by a fast batch is not said late: only the furthest one reached is news
  said.add(milestone.key);
  announce(milestone.words);
}

/** Listen for milestones while at least one import surface is on screen. */
export function useImportAnnouncer(): void {
  useEffect(() => {
    watchers += 1;
    if (watchers === 1) {
      // an import already under way counts as a new run only if it was not heard running before
      // (a surface remounting mid-import must not repeat what was said)
      const phase = importSnapshot().phase;
      if (phase === 'running' && lastPhase !== 'running') run += 1;
      lastPhase = phase;
      unsubscribe = subscribeImport(hear);
    }
    return () => {
      watchers -= 1;
      if (watchers === 0) { unsubscribe?.(); unsubscribe = null; }
    };
  }, []);
}
