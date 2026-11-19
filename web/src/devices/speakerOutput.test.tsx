import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_STATUS } from '../copy';
import { PlayingBar, speakerOutput } from './PlayingBar';
import { Api, outputReport, SessionState, Speaker, usePlaybackDevice } from './usePlaybackDevice';

// BF-0457-03: the speaker reports what it knows about its sound output with each heartbeat, and
// controllers show it in the shared PLAYBACK_STATUS words. 'playing' only ever comes with the
// time a person confirmed the check tone.

afterEach(() => { cleanup(); vi.useRealTimers(); });

const clock = () => Date.now() / 1000;
const session = (over: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: 'r1', song_index: 0, offset_ms: 0, anchor_at: clock(), state: 'playing',
  active_device_id: 'other', lease_expires_at: clock() + 60, seq: 4, fence: 7, state_confidence: 'fresh', ...over,
});

const withOutput = (output: { status: string; at?: number } | null): Speaker => ({
  start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  position: () => ({ song_index: 0, offset_ms: 1000, state: 'playing' }), active: () => true,
  ...(output ? { state: () => ({ output }) } : {}),
});

describe('what the speaker reports', () => {
  it('maps the engine output status to the heartbeat fields, never inventing a confirmation', () => {
    expect(outputReport(withOutput({ status: 'verified_at', at: 1700 }))).toEqual({ output_status: 'playing', output_verified_at: 1700 });
    expect(outputReport(withOutput({ status: 'interrupted' }))).toEqual({ output_status: 'interrupted' });
    expect(outputReport(withOutput({ status: 'uncertain' }))).toEqual({ output_status: 'uncertain' });
    expect(outputReport(withOutput({ status: 'output_unverified' }))).toEqual({ output_status: 'output_unverified' });
    expect(outputReport(withOutput({ status: 'verified_at' }))).toEqual({});
    expect(outputReport(withOutput(null))).toEqual({});
    expect(outputReport(null)).toEqual({});
  });

  it('sends it with each heartbeat', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const beats: Record<string, unknown>[] = [];
    const here = session({ active_device_id: 'me' });
    const api = (async (path: string, init?: RequestInit) => {
      if (path === '/devices') return { device: { id: 'me', name: 'Tablet', kind: 'tablet', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
      if (path === '/playback/reconnect') return { action: 'continue', session: here, message: null };
      if (path.startsWith('/playback/session')) return { session: here, speaker: 'here', speaker_device_id: 'me', speaker_name: 'Tablet', ask_before_playing_here: false, server_time: clock() };
      if (path === '/playback/heartbeat') { beats.push(JSON.parse(String(init?.body))); return { outcome: 'renewed', session: here, server_time: clock() }; }
      throw new Error(`unexpected ${path}`);
    }) as Api;
    const speaker = withOutput({ status: 'interrupted' });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    await waitFor(() => expect(beats.length).toBeGreaterThan(0));
    expect(beats[0]).toMatchObject({ output_status: 'interrupted' });
    hook.unmount();
  });
});

describe('what controllers show', () => {
  it('reads the wire status as the shared vocabulary', () => {
    expect(speakerOutput(session({ output_status: 'playing', output_verified_at: 1700 }))).toEqual({ state: 'playing', verifiedAt: 1700 });
    expect(speakerOutput(session({ output_status: 'playing' }))).toEqual({ state: 'output_unverified' });
    expect(speakerOutput(session({ output_status: 'uncertain' }))).toEqual({ state: 'uncertain' });
    expect(speakerOutput(session())).toBeNull();
    expect(speakerOutput(null)).toBeNull();
  });

  const remoteApi = (current: SessionState): Api => (async (path: string) => {
    if (path === '/devices') return { device: { id: 'phone', name: 'Phone', kind: 'phone', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
    if (path === '/playback/reconnect') return { action: 'stop_moved', session: current, message: null };
    if (path.startsWith('/playback/session')) return { session: current, speaker: 'elsewhere', speaker_device_id: 'other', speaker_name: 'Bar tablet', ask_before_playing_here: true, server_time: clock() };
    throw new Error(`unexpected ${path}`);
  }) as Api;

  it('shows a remote speaker interrupted in the PLAYBACK_STATUS words', async () => {
    render(<PlayingBar api={remoteApi(session({ output_status: 'interrupted' }))} workspaceId="ws-output" source={async () => null} />);
    const line = await screen.findByTestId('speaker-output');
    expect(line.textContent).toBe(`${PLAYBACK_STATUS.interrupted.label}. ${PLAYBACK_STATUS.interrupted.detail}`);
  });

  it('renders nothing when the speaker reports nothing', async () => {
    render(<PlayingBar api={remoteApi(session())} workspaceId="ws-output-none" source={async () => null} />);
    expect(await screen.findByText('Playing on Bar tablet', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId('speaker-output')).toBeNull();
  });
});
