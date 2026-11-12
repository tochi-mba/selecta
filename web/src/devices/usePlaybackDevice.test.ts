import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Api, extrapolate, FADE_MS, SessionState, Speaker, SPEAKER_POLL_MS, START_DELAY_MS, usePlaybackDevice } from './usePlaybackDevice';

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

  it('tears the speaker down when the page lets it go', () => {
    const speaker: Speaker = { start: async () => {}, stop: vi.fn(), pause: () => {}, resume: () => {}, position: () => null, active: () => false, dispose: vi.fn() };
    const api = (() => new Promise(() => {})) as Api;
    const { unmount } = renderHook(() => usePlaybackDevice({ api, workspaceId: 'w1', speaker }));
    unmount();
    expect(speaker.dispose).toHaveBeenCalledTimes(1);
  });
});
