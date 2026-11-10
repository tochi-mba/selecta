import { describe, expect, it } from 'vitest';
import type { ExportJobState, SeamState } from '../api';
import { exportStage } from '../views/ExportJobs';
import { analysisState, exportState, isSuccess, loadedState, seamState, WORK_STATES, WORK_WORDS, WorkState } from './workState';

/** UF-0371-01 and UF-0371-06: the cross-route state matrix. Every asynchronous source maps onto one
 * nine-word vocabulary, every word is reachable, and nothing cancelled, superseded or failed reads as
 * success. */

const EXPORTS: ExportJobState[] = ['preparing', 'encoding', 'ready', 'failed', 'cancelling', 'cancelled', 'interrupted', 'expired'];
const SEAMS: SeamState['status'][] = ['none', 'queued', 'rendering', 'ready', 'failed'];
const analysis = (left: number, running: boolean, paused: boolean, storage_full = false) =>
  ({ analysis: { left, running, paused, asked_for: 0 }, storage_full });

describe('the async state vocabulary', () => {
  it('has nine distinct states, each with its own words and a status mark', () => {
    expect(WORK_STATES).toEqual(['initial', 'stale', 'queued', 'running', 'paused', 'blocked', 'cancelled', 'failed', 'ready']);
    const words = WORK_STATES.map((state) => WORK_WORDS[state].words);
    expect(new Set(words).size).toBe(WORK_STATES.length);
    expect(WORK_STATES.filter(isSuccess)).toEqual(['ready']);
  });

  it('page reads keep loading, refreshing, stale and failed apart', () => {
    expect((['loading', 'ready', 'refreshing', 'stale', 'failed'] as const).map((state) => loadedState({ state })))
      .toEqual(['initial', 'ready', 'running', 'stale', 'failed']);
  });

  it('a seam that is cached but blocked where it is placed is never ready', () => {
    expect(SEAMS.map((status) => seamState(status))).toEqual(['initial', 'queued', 'running', 'ready', 'failed']);
    expect(seamState('ready', true)).toBe('blocked');
    expect(seamState('queued', true)).toBe('blocked');
    expect(seamState('failed', true)).toBe('failed');
  });

  it('the analysis queue says paused, blocked by storage, running, waiting or done', () => {
    expect(analysisState(analysis(5, false, true))).toBe('paused');
    expect(analysisState(analysis(5, true, false, true))).toBe('blocked');
    expect(analysisState(analysis(5, true, false))).toBe('running');
    expect(analysisState(analysis(5, false, false))).toBe('queued');
    expect(analysisState(analysis(0, false, true))).toBe('ready');
  });

  it('exports: cancelled, interrupted and expired never read as done, and Workspace agrees', () => {
    const mapped = Object.fromEntries(EXPORTS.map((state) => [state, exportState(state)])) as Record<ExportJobState, WorkState>;
    expect(mapped).toEqual({
      preparing: 'queued', encoding: 'running', ready: 'ready', failed: 'failed',
      cancelling: 'running', cancelled: 'cancelled', interrupted: 'failed', expired: 'stale',
    });
    for (const state of EXPORTS) {
      expect(isSuccess(mapped[state]), state).toBe(state === 'ready');
      // the export list on its own page shows the same kind of mark for each state
      const shown = exportStage({ state }).kind;
      expect(shown === 'ready', `${state} shown as ${shown}`).toBe(isSuccess(mapped[state]));
      if (mapped[state] === 'failed') expect(shown).toBe('failed');
      if (mapped[state] === 'running' || mapped[state] === 'queued') expect(shown).toBe('working');
    }
  });

  it('every state is reached by at least one real source', () => {
    const reached = new Set<WorkState>([
      ...(['loading', 'ready', 'refreshing', 'stale', 'failed'] as const).map((state) => loadedState({ state })),
      ...SEAMS.map((status) => seamState(status)), seamState('queued', true),
      analysisState(analysis(5, false, true)),
      ...EXPORTS.map(exportState),
    ]);
    expect([...reached].sort()).toEqual([...WORK_STATES].sort());
  });
});
