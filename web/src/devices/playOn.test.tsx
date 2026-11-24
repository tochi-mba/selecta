import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceHolding } from './controller';
import { ControllerListen, holdingWords } from './ControllerListen';
import { askWords, soundAllowedHere, START_ANSWER_EVENT, START_ASK_EVENT, START_ASK_WAIT_MS, usePlayOn, type StartAnswer, type StartAsk } from './playOn';

// ADR-0475 R2, "Play on {device}": the asker shows exactly what the asked device said, and the
// asked device answers only an ask addressed to it that has not run out.

afterEach(() => { cleanup(); vi.useRealTimers(); });

const ASK: StartAsk = { ask_id: 'ask-1', target_device_id: 'laptop', target_name: 'Laptop', asker_device_id: 'phone', asker_name: 'Phone', mix_id: 'mix-1', expires_at: 1_010 };

function harness(deviceId: string, onAsk: (ask: StartAsk) => Promise<StartAnswer['result']> = vi.fn(async () => 'starting' as const), post: (path: string, body: unknown) => unknown = () => ASK) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, body });
    return post(path, body);
  }) as <T>(path: string, init?: RequestInit) => Promise<T>;
  const hook = renderHook(() => usePlayOn({ cloud, deviceId, enabled: true, serverNow: () => 1_000, onAsk }));
  return { hook, calls, onAsk };
}
const hear = (name: string, detail: unknown) => act(() => { window.dispatchEvent(new CustomEvent(name, { detail })); });
const answer = (result: StartAnswer['result'], over: Partial<StartAnswer> = {}): StartAnswer => ({ ask_id: 'ask-1', asker_device_id: 'phone', target_device_id: 'laptop', target_name: 'Laptop', result, ...over });

describe('asking another device to play', () => {
  it('sends the ask with the mix, and says each thing the other device answers in its own words', async () => {
    const { hook, calls } = harness('phone');
    await act(async () => { await hook.result.current.ask({ device_id: 'laptop', name: 'Laptop' }, 'mix-1'); });
    expect(calls[0]).toEqual({ path: '/playback/start-asks', body: { device_id: 'phone', target_device_id: 'laptop', mix_id: 'mix-1' } });
    expect(hook.result.current.state).toMatchObject({ phase: 'asking', device: 'Laptop' });
    hear(START_ANSWER_EVENT, answer('needs_gesture'));
    expect(hook.result.current.state?.phase).toBe('needs_gesture');
    expect(askWords('needs_gesture', 'Laptop')).toBe('Laptop needs one press of Play. Press Play on Laptop to allow sound.');
    // the press happens there, and the same ask is answered again
    hear(START_ANSWER_EVENT, answer('starting'));
    expect(hook.result.current.state?.phase).toBe('starting');
    expect(askWords('starting', 'Laptop')).toBe('Starting on Laptop…');
    expect(askWords('needs_music', 'Laptop')).toBe('Laptop needs its music folder again. Choose it on Laptop.');
    act(() => hook.result.current.reset());
    expect(hook.result.current.state).toBeNull();
  });

  it('says the device did not answer after ten seconds, and never that it started', async () => {
    vi.useFakeTimers();
    const { hook } = harness('phone');
    await act(async () => { await hook.result.current.ask({ device_id: 'laptop', name: 'Laptop' }, null); });
    act(() => { vi.advanceTimersByTime(START_ASK_WAIT_MS + 10); });
    expect(hook.result.current.state?.phase).toBe('no_answer');
    expect(askWords('no_answer', 'Laptop')).toBe('Laptop didn’t answer. Is SelectaDJ open on it?');
  });

  it('ignores an answer to another ask or for another device', async () => {
    const { hook } = harness('phone');
    await act(async () => { await hook.result.current.ask({ device_id: 'laptop', name: 'Laptop' }, null); });
    hear(START_ANSWER_EVENT, answer('starting', { ask_id: 'someone-elses' }));
    hear(START_ANSWER_EVENT, answer('starting', { asker_device_id: 'tablet' }));
    expect(hook.result.current.state?.phase).toBe('asking');
  });

  it('says a device that is not open cannot be asked', async () => {
    const { hook } = harness('phone', undefined, () => { throw Object.assign(new Error('not open'), { code: 'target_offline' }); });
    await act(async () => { await hook.result.current.ask({ device_id: 'laptop', name: 'Laptop' }, null); });
    expect(hook.result.current.state?.phase).toBe('offline');
  });
});

describe('being asked to play', () => {
  it('answers an ask addressed to this device with what it decided', async () => {
    const { calls, onAsk } = harness('laptop', vi.fn(async () => 'needs_music' as const), () => ({}));
    hear(START_ASK_EVENT, ASK);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onAsk).toHaveBeenCalledWith(ASK);
    expect(calls).toEqual([{ path: '/playback/start-asks/ask-1/answer', body: { device_id: 'laptop', asker_device_id: 'phone', result: 'needs_music' } }]);
  });

  it('does nothing for an ask meant for another device, or one that has run out', async () => {
    const { calls, onAsk } = harness('laptop', undefined, () => ({}));
    hear(START_ASK_EVENT, { ...ASK, target_device_id: 'tablet' });
    hear(START_ASK_EVENT, { ...ASK, expires_at: 990 });
    await act(async () => { await Promise.resolve(); });
    expect(onAsk).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('treats a page whose activation is unknown as not yet allowed to start sound', () => {
    expect(soundAllowedHere()).toBe(false);
  });
});

describe('Listen on a device with no music while nothing plays', () => {
  const device = (id: string, name: string, songs: number, online: boolean, seen = 1_000): DeviceHolding => ({ device_id: id, name, last_seen_at: seen, online, songs, reported_at: songs ? seen : null });

  it('offers one thing, Play on the open device with the most music, and no Play button of its own', () => {
    const onPlayOn = vi.fn();
    render(<ControllerListen mixName="Friday mix" mixSongs={12} devices={[device('phone', 'This phone', 0, true), device('laptop', 'Laptop', 2864, true), device('tablet', 'Tablet', 40, false, 400)]} thisDeviceId="phone" now={1_000} asking={null} onPlayOn={onPlayOn} />);
    expect(screen.getByTestId('controller-where')).toHaveTextContent('Nothing is playing');
    expect(screen.getByRole('heading', { name: 'Friday mix' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Play on Laptop' }).click();
    expect(onPlayOn).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'laptop' }));
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.getByText('40 songs. Not open right now, last open 10 minutes ago')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect music here' })).toBeInTheDocument();
  });

  it('says so plainly when no device with music is open, and lists them with when each was last open', () => {
    render(<ControllerListen mixName="" mixSongs={0} devices={[device('laptop', 'Laptop', 2864, false, 1_000 - 7200)]} thisDeviceId="phone" now={1_000} asking={null} onPlayOn={vi.fn()} />);
    expect(screen.getByTestId('controller-none')).toHaveTextContent('None of your devices with music is open right now. Open SelectaDJ on one of them.');
    expect(screen.queryByTestId('play-on')).toBeNull();
    expect(holdingWords(device('laptop', 'Laptop', 2864, false, 1_000 - 7200), 1_000)).toBe('2,864 songs. Not open right now, last open 2 hours ago');
  });

  it('shows what the other device said while it is being asked', () => {
    render(<ControllerListen mixName="Friday mix" mixSongs={12} devices={[device('laptop', 'Laptop', 12, true)]} thisDeviceId="phone" now={1_000} asking={{ phase: 'needs_gesture', device: 'Laptop', deviceId: 'laptop' }} onPlayOn={vi.fn()} />);
    expect(screen.getByTestId('play-on-status')).toHaveTextContent('Laptop needs one press of Play. Press Play on Laptop to allow sound.');
    expect(screen.getByTestId('play-on')).toBeEnabled();
  });
});
