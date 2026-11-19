import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Speaker } from './usePlaybackDevice';
import { SPEAKER_ROUTES, useZoneSpeaker } from './useZoneSpeaker';

// Play here for a business zone (ADR-0443 BZ-0443-05): register in the organisation, take the
// lease (asking first when the server says a kiosk is playing), play the zone's programme,
// heartbeat with the fence, stop when someone else holds the lease, and hand back.

const session = (extra: Record<string, unknown> = {}) => ({
  zone_id: 'bar', mix_revision_id: null, song_index: 3, offset_ms: 1000, anchor_at: 100, state: 'playing',
  active_device_id: 'dev-1', lease_expires_at: 10_000_000_000, seq: 4, fence: 7, volume: 60, hand_back_to_device_id: null, ...extra,
});

function fakeSpeaker(): Speaker & { started: unknown[]; stopped: number[] } {
  const started: unknown[] = [];
  const stopped: number[] = [];
  return {
    started, stopped,
    start: async (index, offset, playing) => { started.push([index, offset, playing]); },
    stop: (fade) => { stopped.push(fade); },
    pause: () => undefined, resume: () => undefined, setVolume: () => undefined,
    position: () => ({ song_index: 3, offset_ms: 2000, state: 'playing' }),
    active: () => true,
  };
}

type Call = [string, RequestInit | undefined, string | undefined];
let calls: Call[];
let answers: Record<string, () => unknown>;

const api: Api = (async (path: string, init?: RequestInit, workspaceId?: string) => {
  calls.push([path, init, workspaceId]);
  const key = Object.keys(answers).find((prefix) => path.startsWith(prefix));
  if (!key) throw Object.assign(new Error('not found'), { status: 404 });
  return answers[key]();
}) as Api;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  calls = [];
  answers = {
    '/devices': () => ({ device: { id: 'dev-1' } }),
    '/zones/bar/playback/take-over': () => ({ session: session(), previous_device: null, server_time: 200 }),
    [SPEAKER_ROUTES.horizon('bar')]: () => ({ segments: [{ key: 'k3', song_index: 3 }] }),
    [SPEAKER_ROUTES.segment('bar')]: () => ({ url: 'https://files.test/k3' }),
    '/zones/bar/playback/heartbeat': () => ({ outcome: 'renewed', session: session(), server_time: 205 }),
    '/zones/bar/playback/hand-back': () => ({ session: session({ active_device_id: 'kiosk' }), server_time: 210 }),
  };
});
afterEach(() => { vi.useRealTimers(); });

function mount(speaker = fakeSpeaker()) {
  const hook = renderHook(() => useZoneSpeaker({ api, workspaceId: 'crown', zoneId: 'bar', zoneName: 'Bar', speakerFor: () => speaker }));
  return { hook, speaker };
}

describe('useZoneSpeaker', () => {
  it('takes the zone, plays its programme and heartbeats with the fence', async () => {
    const { hook, speaker } = mount();
    await act(async () => { expect(await hook.result.current.playHere()).toBe('speaking'); });
    expect(hook.result.current.phase).toBe('speaking');
    expect(speaker.started[0]).toEqual([3, expect.any(Number), true]);
    const takeOver = calls.find(([path]) => path.endsWith('/take-over'))!;
    expect(takeOver[2]).toBe('crown');
    expect(JSON.parse(takeOver[1]!.body as string)).toEqual({ device_id: 'dev-1', start_playing: true, confirm: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const beat = calls.find(([path]) => path.endsWith('/heartbeat'))!;
    expect(JSON.parse(beat[1]!.body as string)).toMatchObject({ device_id: 'dev-1', song_index: 3, offset_ms: 2000, fence: 7, seq: 4 });
  });

  it('asks first when a kiosk is playing, then confirms', async () => {
    let asked = false;
    answers['/zones/bar/playback/take-over'] = () => {
      if (!asked) { asked = true; throw Object.assign(new Error('Play Bar music from this phone?'), { status: 409, code: 'confirm_needed' }); }
      return { session: session(), previous_device: { id: 'kiosk', name: 'Bar player' }, server_time: 200 };
    };
    const { hook } = mount();
    await act(async () => { expect(await hook.result.current.playHere()).toBe('confirm'); });
    expect(hook.result.current.phase).toBe('confirm');
    await act(async () => { expect(await hook.result.current.playHere(true)).toBe('speaking'); });
    const second = calls.filter(([path]) => path.endsWith('/take-over'))[1];
    expect(JSON.parse(second[1]!.body as string).confirm).toBe(true);
  });

  it('stops at once when another device holds the lease', async () => {
    const { hook, speaker } = mount();
    await act(async () => { await hook.result.current.playHere(); });
    answers['/zones/bar/playback/heartbeat'] = () => ({ outcome: 'refused', session: session({ active_device_id: 'kiosk' }), server_time: 206 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.message).toMatch(/another device/);
    expect(speaker.stopped.length).toBe(1);
  });

  it('hands back with where the music is', async () => {
    const { hook, speaker } = mount();
    await act(async () => { await hook.result.current.playHere(); });
    await act(async () => { await hook.result.current.handBack(); });
    const back = calls.find(([path]) => path.endsWith('/hand-back'))!;
    expect(JSON.parse(back[1]!.body as string)).toEqual({ device_id: 'dev-1', song_index: 3, offset_ms: 2000 });
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.message).toBe('Bar handed back');
    expect(speaker.stopped.length).toBe(1);
  });

  it('says why when the zone refuses', async () => {
    answers['/zones/bar/playback/take-over'] = () => { throw Object.assign(new Error('x'), { status: 409, code: 'person_speaker_off', payload: { detail: { code: 'person_speaker_off', message: 'Staff phones cannot play Bar.' } } }); };
    const { hook } = mount();
    await act(async () => { expect(await hook.result.current.playHere()).toBe('failed'); });
    expect(hook.result.current.error).toBe('Staff phones cannot play Bar.');
  });
});
