import { describe, expect, it } from 'vitest';
import { problemKind } from '../api';
import { mixReadiness } from '../state/readiness';
import { analysisState, exportState, isSuccess, seamState, WorkState } from '../state/workState';
import { requestWords } from '../views/Requests';
import { songs } from './backend';
import { EXPORT, jobs, OPERATION_STATES, OperationState, RENDER, REQUEST, STEM, STORAGE_BLOCKED_JOBS } from './operations';

/** T0012: each shared operation fixture still reads as the state it is named for. */
describe('operation fixtures (T0012)', () => {
  it('cover all six states for renders, requests, stems and exports', () => {
    for (const set of [RENDER, REQUEST, STEM, EXPORT]) expect(Object.keys(set).sort()).toEqual([...OPERATION_STATES].sort());
  });

  it('render fixtures map onto the shared work vocabulary, and only ready is success', () => {
    const expected: Record<OperationState, WorkState> = { pending: 'queued', ready: 'ready', failed: 'failed', canceled: 'initial', stale: 'blocked', storageBlocked: 'failed' };
    for (const name of OPERATION_STATES) {
      const fixture = RENDER[name];
      const state = seamState(fixture.state.status, !!fixture.tooSoon);
      expect(state, name).toBe(expected[name]);
      expect(isSuccess(state), name).toBe(name === 'ready');
    }
    expect(problemKind(RENDER.storageBlocked.error)).toBe('storage');
  });

  it('a stale render is never counted ready in a mix', () => {
    const mix = songs({ settings: { move: 'bass_swap_blend' }, state: RENDER.stale.state, too_soon: true } as never);
    expect(mixReadiness(mix)).toMatchObject({ ready: 0, blocked: 1, allReady: false, firstProblem: 1 });
  });

  it('stem fixtures map onto the shared work vocabulary', () => {
    const expected: Record<OperationState, WorkState> = { pending: 'running', ready: 'ready', failed: 'failed', canceled: 'initial', stale: 'blocked', storageBlocked: 'failed' };
    for (const name of OPERATION_STATES) expect(seamState(STEM[name].status, !!STEM[name].stale), name).toBe(expected[name]);
    expect(problemKind(STEM.storageBlocked.problem)).toBe('storage');
  });

  it('export fixtures map onto the shared work vocabulary', () => {
    const expected: Record<OperationState, WorkState> = { pending: 'queued', ready: 'ready', failed: 'failed', canceled: 'cancelled', stale: 'stale', storageBlocked: 'failed' };
    for (const name of OPERATION_STATES) {
      expect(exportState(EXPORT[name].state), name).toBe(expected[name]);
      expect(isSuccess(exportState(EXPORT[name].state)), name).toBe(name === 'ready');
    }
    expect(EXPORT.storageBlocked.error).toMatch(/free space/);
    expect(EXPORT.canceled.can_cancel).toBe(false);
  });

  it('request fixtures read as their state on the Requests page', () => {
    const tone = (name: OperationState) => requestWords(REQUEST[name].row, REQUEST[name].stage).tone;
    expect(tone('pending')).toBe('active');
    expect(requestWords(REQUEST.ready.row, REQUEST.ready.stage).label).toBe('Ready for an opening');
    expect(tone('failed')).toBe('stuck');
    expect(requestWords(REQUEST.canceled.row, REQUEST.canceled.stage).detail).toMatch(/said no/);
    expect(requestWords(REQUEST.stale.row, REQUEST.stale.stage).detail).toMatch(/stopped fitting/);
    expect(problemKind(REQUEST.storageBlocked.problem)).toBe('storage');
  });

  it('a full disk blocks queued analysis, and a clear queue is ready', () => {
    expect(analysisState(STORAGE_BLOCKED_JOBS)).toBe('blocked');
    expect(analysisState(jobs())).toBe('ready');
  });
});
