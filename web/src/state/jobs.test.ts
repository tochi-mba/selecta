import { describe, expect, it } from 'vitest';
import type { Jobs } from '../api';
import { jobAttention } from './jobs';

describe('job attention', () => {
  it('never crashes the app for an incomplete status from a different server version', () => {
    expect(jobAttention(null)).toBe(0);
    expect(jobAttention([] as unknown as Jobs)).toBe(0);
    expect(jobAttention({ failed_seams: [] } as unknown as Jobs)).toBe(0);
  });

  it('counts actual failures and a paused queue when the status is complete', () => {
    const jobs = {
      storage_full: true,
      failed_seams: [{ from: 'A', to: 'B' }],
      failed_songs: [{ id: 1, title: 'C', artist: null }],
      analysis: { paused: true, left: 4 },
    } as Jobs;
    expect(jobAttention(jobs)).toBe(4);
  });
});
