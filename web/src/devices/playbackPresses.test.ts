import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, neverReached, NO_SPEAKER_WORDS, SessionState, SessionView, Speaker, usePlaybackDevice } from './usePlaybackDevice';

// Presses and looks between a speaker and its remotes (ADR-0461, ADR-0475): a slow connection
// must not starve the session look, a press the session did not take is not called a success,
// a volume the session cannot hold is never sent, and a speaker that could not start is not one.

afterEach(() => cleanup());

const clock = () => Date.now() / 1000;
const session = (over: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: null, song_index: 0, offset_ms: 0, anchor_at: clock(), state: 'playing',
  active_device_id: 'me', lease_expires_at: clock() + 60, seq: 4, fence: 7, state_confidence: 'fresh', ...over,
});
const DEVICE = { device: { id: 'me', name: 'Phone', kind: 'phone', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
const speakerWith = (position: Speaker['position'], start: Speaker['start'] = vi.fn(async () => undefined)): Speaker => ({
  start, stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position, active: () => true,
});

/** A device that is a remote: another device is the speaker. `commands` answers each press. */
function remoteServer(current: () => SessionState, commands: (body: { command: string }) => unknown, sessionDelayMs = 0) {
  const sent: { command: string; args?: Record<string, unknown> }[] = [];
  let looks = 0;
  const api = (async (path: string, init?: RequestInit) => {
    if (path === '/devices') return DEVICE;
    if (path === '/playback/reconnect') return { action: 'none', session: null, message: null };
    if (path.startsWith('/playback/session')) {
      looks += 1;
      if (sessionDelayMs) await new Promise((resolve) => setTimeout(resolve, sessionDelayMs));
      return { session: current(), speaker: 'elsewhere', speaker_device_id: 'laptop', speaker_name: 'Laptop', ask_before_playing_here: true, server_time: clock() } satisfies SessionView;
    }
    if (path === '/playback/commands') {
      const body = JSON.parse(String(init?.body)) as { command: string; args?: Record<string, unknown> };
      sent.push(body);
      return commands(body);
    }
    return {};
  }) as Api;
  return { api, sent, looks: () => looks };
}

describe('the session look on a slow connection', () => {
  it('waits for the look in flight, so its answer is used and not thrown away for a newer one', async () => {
    // every look takes longer than the two seconds between a remote's looks
    const { api, looks } = remoteServer(() => session({ active_device_id: 'laptop', seq: 9 }), () => ({}), 2600);
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: null }));
    await waitFor(() => expect(hook.result.current.view?.session?.seq).toBe(9), { timeout: 8000 });
    // and it did not stack a new look on top of each one still waiting
    expect(looks()).toBeLessThanOrEqual(3);
    hook.unmount();
  }, 12_000);
});

describe('a press the session did not take', () => {
  it('Play with nobody playing is not a success, and says to choose a device', async () => {
    const { api } = remoteServer(() => session({ active_device_id: null, state: 'paused' }), () => ({ status: 'no_speaker' }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: null }));
    await waitFor(() => expect(hook.result.current.view?.session).toBeTruthy(), { timeout: 4000 });
    let taken = true;
    await act(async () => { taken = await hook.result.current.send('play'); });
    expect(taken).toBe(false);
    expect(hook.result.current.error).toBe(NO_SPEAKER_WORDS);
    hook.unmount();
  });

  it('a later press that is taken clears what the refused one said', async () => {
    let answer: unknown = { status: 'no_speaker' };
    const { api } = remoteServer(() => session({ active_device_id: 'laptop' }), () => answer);
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: null }));
    await waitFor(() => expect(hook.result.current.view?.session).toBeTruthy(), { timeout: 4000 });
    await act(async () => { await hook.result.current.send('play'); });
    expect(hook.result.current.error).toBe(NO_SPEAKER_WORDS);
    answer = { status: 'applied' };
    await act(async () => { expect(await hook.result.current.send('pause')).toBe(true); });
    expect(hook.result.current.error).toBe('');
    hook.unmount();
  });

  it('only a press that never reached SelectaDJ counts as unreachable; a busy or failing server answered', () => {
    expect(neverReached(new TypeError('Failed to fetch'))).toBe(true);
    expect(neverReached(Object.assign(new Error('timeout'), { status: 408 }))).toBe(true);
    expect(neverReached(Object.assign(new Error('slow down'), { status: 429 }))).toBe(false);
    expect(neverReached(Object.assign(new Error('broke'), { status: 503 }))).toBe(false);
    expect(neverReached(Object.assign(new Error('no'), { status: 409 }))).toBe(false);
  });
});

describe('volume on a session that keeps volume on each device', () => {
  it('is never sent, and leaves no refusal behind', async () => {
    const { api, sent } = remoteServer(() => session({ active_device_id: 'laptop' }), () => ({ status: 'applied' }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: null }));
    await waitFor(() => expect(hook.result.current.view?.session).toBeTruthy(), { timeout: 4000 });
    await act(async () => { expect(await hook.result.current.send('set_volume', { volume: 40 })).toBe(false); });
    expect(sent).toEqual([]);
    expect(hook.result.current.error).toBe('');
    hook.unmount();
  });

  it('is sent when the session carries a shared volume (a venue zone)', async () => {
    const { api, sent } = remoteServer(() => session({ active_device_id: 'laptop', volume: 80 }), () => ({ status: 'applied' }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: null }));
    await waitFor(() => expect(hook.result.current.view?.session).toBeTruthy(), { timeout: 4000 });
    await act(async () => { expect(await hook.result.current.send('set_volume', { volume: 40 })).toBe(true); });
    expect(sent.map((press) => press.command)).toEqual(['set_volume']);
    hook.unmount();
  });
});

/** This device is the speaker (it reconnects as one). */
function speakerServer(current: () => SessionState, commands?: (body: { args: { songs: number[]; song_index: number } }) => Promise<unknown>) {
  const beats: string[] = [];
  const api = (async (path: string, init?: RequestInit) => {
    if (path === '/devices') return DEVICE;
    if (path === '/playback/reconnect') return { action: 'continue', session: current(), message: null, envelope_key: null };
    if (path.startsWith('/playback/session')) return { session: current(), speaker: 'here', speaker_device_id: 'me', speaker_name: 'Phone', ask_before_playing_here: false, server_time: clock() };
    if (path === '/playback/heartbeat') { beats.push(path); return { outcome: 'renewed', session: current(), server_time: clock() }; }
    if (path === '/playback/commands' && commands) return commands(JSON.parse(String(init?.body)) as { args: { songs: number[]; song_index: number } });
    return {};
  }) as Api;
  return { api, beats };
}

describe('a speaker that could not start', () => {
  it('stops being the speaker, so no other device reads "Playing on this device" over silence', async () => {
    const { api } = speakerServer(() => session());
    const failing = speakerWith(() => null, vi.fn(async () => { throw new Error('the browser refused to start audio'); }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: failing }));
    await waitFor(() => expect(failing.start).toHaveBeenCalled());
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(false));
    expect(failing.stop).toHaveBeenCalled();
    expect(hook.result.current.message).toBe('This device couldn’t start playing.');
    hook.unmount();
  });
});

describe('a press that lands while this speaker is sending its own programme', () => {
  it('is carried out once the programme change has landed, never dropped as already applied', async () => {
    let now = session({ seq: 4, song_index: 0, offset_ms: 30_000 });
    let land: (value: unknown) => void = () => undefined;
    const { api } = speakerServer(() => now, () => new Promise((resolve) => { land = resolve; }));
    const speaker = speakerWith(() => ({ song_index: 0, offset_ms: 30_000, state: 'playing' }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
    const starts = () => (speaker.start as ReturnType<typeof vi.fn>).mock.calls.length;
    const before = starts();
    let publishing: Promise<boolean> = Promise.resolve(false);
    act(() => { publishing = hook.result.current.publishProgramme([11, 12, 13], 0); });
    // a remote's skip is applied by the server while the programme change is still on its way
    now = session({ seq: 6, song_index: 1, offset_ms: 0, programme: [11, 12, 13].map((song_id) => ({ song_id, sha256: 'c'.repeat(64) })) });
    await act(async () => { await hook.result.current.refreshSession(); });
    expect(starts()).toBe(before);
    await act(async () => { land({ status: 'applied', applied_seq: 5 }); await publishing; });
    await act(async () => { await hook.result.current.refreshSession(); });
    expect(starts()).toBe(before + 1);
    expect((speaker.start as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(1);
    hook.unmount();
  });
});

describe('a reloaded speaker tab pressed while it reconnects', () => {
  it('starts the sound once, from the press, never again from the reconnect', async () => {
    let looks = 0;
    let firstLook: (value: unknown) => void = () => undefined;
    const answer = () => ({ session: session(), speaker: 'here', speaker_device_id: 'me', speaker_name: 'Phone', ask_before_playing_here: false, server_time: clock() });
    const api = (async (path: string) => {
      if (path === '/devices') return DEVICE;
      if (path === '/playback/reconnect') return { action: 'continue', session: session(), message: null, envelope_key: null };
      if (path === '/playback/take-over') return { session: session(), previous_device: null, server_time: clock() };
      if (path.startsWith('/playback/session')) {
        looks += 1;
        // the reconnect's check is slow: the press lands while it waits
        if (looks === 1) await new Promise((resolve) => { firstLook = resolve; });
        return answer();
      }
      if (path === '/playback/heartbeat') return { outcome: 'renewed', session: session(), server_time: clock() };
      return {};
    }) as Api;
    const speaker = speakerWith(() => ({ song_index: 0, offset_ms: 0, state: 'playing' }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(looks).toBe(1));
    let pressed: Promise<void> = Promise.resolve();
    act(() => { pressed = hook.result.current.playHere(); });
    await act(async () => { await pressed; });
    expect(speaker.start).toHaveBeenCalledTimes(1);
    await act(async () => { firstLook(undefined); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(speaker.start).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});

describe('a skip from another device that the speaker cannot play', () => {
  it('stops here, tells the session it stopped, and says why', async () => {
    let now = session({ seq: 4, song_index: 0 });
    const beats: { state?: string; output_status?: string }[] = [];
    const api = (async (path: string, init?: RequestInit) => {
      if (path === '/devices') return DEVICE;
      if (path === '/playback/reconnect') return { action: 'continue', session: now, message: null, envelope_key: null };
      if (path.startsWith('/playback/session')) return { session: now, speaker: 'here', speaker_device_id: 'me', speaker_name: 'Phone', ask_before_playing_here: false, server_time: clock() };
      if (path === '/playback/heartbeat') { beats.push(JSON.parse(String(init?.body))); return { outcome: 'renewed', session: now, server_time: clock() }; }
      return {};
    }) as Api;
    let calls = 0;
    const start = vi.fn(async () => { calls += 1; if (calls > 1) throw new Error('decode failed'); });
    const speaker = speakerWith(() => ({ song_index: 0, offset_ms: 0, state: 'playing' }), start);
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
    now = session({ seq: 6, song_index: 2 });
    await act(async () => { await hook.result.current.refreshSession(); });
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(false));
    expect(hook.result.current.message).toBe('This device couldn’t play that song, so playback stopped here.');
    await waitFor(() => expect(beats.some((beat) => beat.state === 'stopped' && beat.output_status === 'interrupted')).toBe(true));
    hook.unmount();
  });
});
