import { describe, expect, it } from 'vitest';
import { extrapolate, FADE_MS, SessionState, SPEAKER_POLL_MS, START_DELAY_MS } from './usePlaybackDevice';

const session = (over: Partial<SessionState>): SessionState => ({
  mix_revision_id: null, song_index: 2, offset_ms: 10_000, anchor_at: 1000, state: 'playing',
  active_device_id: 'd1', lease_expires_at: 1020, seq: 4, ...over,
});

describe('the playback session on a device', () => {
  it('moves the position on from the anchor while playing', () => {
    expect(extrapolate(session({}), 1003.5)).toBe(13_500);
  });

  it('keeps the position still while paused, and never runs backwards', () => {
    expect(extrapolate(session({ state: 'paused' }), 1100)).toBe(10_000);
    expect(extrapolate(session({}), 999)).toBe(10_000);
  });

  it('waits for the old speaker to hear and fade before starting here', () => {
    expect(START_DELAY_MS).toBeGreaterThan(SPEAKER_POLL_MS + FADE_MS);
  });
});
