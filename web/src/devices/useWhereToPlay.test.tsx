import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, Toaster } from '../ui/toasts';
import type { AskState } from './playOn';
import { useWhereToPlay } from './useWhereToPlay';
import type { Candidate, Situation } from './whereToPlay';

// ADR-0475: Play decided by the one rule, and A1: a device that does not answer is left out.

afterEach(() => { cleanup(); clearToasts(); });
const device = (device_id: string, over: Partial<Candidate> = {}): Candidate => ({ device_id, name: device_id, online: true, songs: 10, last_seen_at: 100, reported_at: 50, ...over });
const situation = (over: Partial<Situation> = {}): Situation => ({ devices: [device('laptop'), device('phone', { songs: 0 })], speaker: null, defaultId: null, thisDeviceId: 'phone', mixIds: [], ids: new Map(), ...over });

describe('Play by the rule', () => {
  it('asks the only device with music, and when it does not answer says so with Try again', () => {
    const askToPlay = vi.fn();
    const playHere = vi.fn();
    const args = { enabled: true, situation: situation(), cloud: vi.fn() as never, playHere, askToPlay, refreshHoldings: vi.fn(), asking: null as AskState };
    const hook = renderHook((props) => useWhereToPlay(props), { initialProps: args });
    render(<Toaster />);
    let handled = false;
    act(() => { handled = hook.result.current.decide(); });
    expect(handled).toBe(true);
    expect(askToPlay).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'laptop' }));
    act(() => { hook.rerender({ ...args, asking: { phase: 'no_answer', device: 'laptop', deviceId: 'laptop' } }); });
    // one line on Listen, not a toast (9bdbd8f7): the hook hands the notice to the page
    const notice = hook.result.current.notice!;
    expect(notice.text).toBe('laptop didn’t answer. It may be asleep; try again, or play somewhere else.');
    act(() => { notice.actions.find((action) => action.label === 'Try again')!.run(); });
    expect(askToPlay).toHaveBeenCalledTimes(2);
  });

  it('plays here when this device is the one', () => {
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: situation({ devices: [device('phone')] }), cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn() }));
    expect(hook.result.current.decide()).toBe(false);
  });

  it('with the flag off, decides nothing (plays here as before)', () => {
    const hook = renderHook(() => useWhereToPlay({ enabled: false, situation: situation(), cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn() }));
    expect(hook.result.current.decide()).toBe(false);
  });
});

describe('A5 and E34', () => {
  it('offers to forget a default speaker not seen for 30 days, and signs it out', async () => {
    const cloud = vi.fn(async () => ({}));
    const refreshHoldings = vi.fn();
    const ghost = device('old-laptop', { online: false, last_seen_at: Date.now() / 1000 - 31 * 24 * 3600 });
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: situation({ devices: [ghost, device('laptop'), device('phone', { songs: 0 })], defaultId: 'old-laptop' }), cloud: cloud as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings }));
    act(() => { hook.result.current.decide(); });
    const forget = hook.result.current.notice!.actions.find((action) => action.label === 'Forget old-laptop');
    expect(forget).toBeDefined();
    await act(async () => { forget!.run(); });
    expect(cloud).toHaveBeenCalledWith('/devices/old-laptop/sign-out', { method: 'POST' });
    expect(refreshHoldings).toHaveBeenCalled();
  });

  it('offline, opens no picker and asks no device: this device plays if it can', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const askToPlay = vi.fn();
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: situation(), cloud: vi.fn() as never, playHere: vi.fn(), askToPlay, refreshHoldings: vi.fn() }));
    expect(hook.result.current.decide()).toBe(false);
    expect(askToPlay).not.toHaveBeenCalled();
    online.mockRestore();
  });
});

// cloud.catalogue_play: a phone with no music of its own, the laptop its usual speaker
describe('Play here instead, with songs in the cloud library', () => {
  const ids = new Map<string, ReadonlySet<number>>([['laptop', new Set([1, 2, 3, 4])]]);
  const press = (over: Partial<Situation>) => {
    const playHereInstead = vi.fn();
    const askToPlay = vi.fn();
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: situation({ defaultId: 'laptop', mixIds: [1, 2, 3, 4], ids, ...over }), cloud: vi.fn() as never, playHere: vi.fn(), askToPlay, refreshHoldings: vi.fn(), playHereInstead }));
    act(() => { expect(hook.result.current.decide()).toBe(true); });
    return { notice: hook.result.current.notice, askToPlay, playHereInstead };
  };

  it('the phone is offered Play here instead when the mix is in the cloud library', () => {
    const { notice, askToPlay, playHereInstead } = press({ cloud: { ids: new Set([1, 2, 3, 4]), songs: 4 } });
    expect(askToPlay).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'laptop' }));
    expect(notice?.text).toBe('Starting on laptop.');
    const instead = notice?.actions.find((action) => action.label === 'Play here instead');
    expect(instead).toBeDefined();
    act(() => instead!.run());
    expect(playHereInstead).toHaveBeenCalled();
  });

  it('a phone used as a remote for songs only the laptop holds keeps today’s behaviour', () => {
    const { notice, askToPlay } = press({ cloud: { ids: new Set([9]), songs: 1 } });
    expect(askToPlay).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'laptop' }));
    expect(notice?.actions.map((action) => action.label)).toEqual([]);
    // and without the cloud library at all, the same
    expect(press({}).notice?.actions.map((action) => action.label)).toEqual([]);
  });
});

describe('D30', () => {
  it('closing the room while the picker is open closes the picker', async () => {
    const { noteRoom } = await import('../rooms/useRoomSession');
    noteRoom({ room: { id: 'r1', name: 'Party' }, code: null, inbox: [], coming_up: [] });
    const two = situation({ devices: [device('laptop'), device('tablet'), device('phone', { songs: 0 })] });
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: two, cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn() }));
    act(() => { hook.result.current.decide(); });
    expect(hook.result.current.picker).toBeTruthy();
    act(() => { noteRoom(null); });
    expect(hook.result.current.picker).toBeFalsy();
  });
});

describe('B16', () => {
  it('says "because the default isn\'t open" once, not on every press', () => {
    localStorage.clear();
    const away = situation({ devices: [device('desk', { online: false }), device('laptop'), device('phone', { songs: 0 })], defaultId: 'desk' });
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: away, cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn() }));
    act(() => { hook.result.current.decide(); });
    expect(hook.result.current.notice?.text).toMatch(/because desk isn’t open/);
    act(() => { hook.result.current.clearNotice(); hook.result.current.decide(); });
    expect(hook.result.current.notice?.text).toBe('Starting on laptop.');
  });
});

describe('T-20261125-45b5: never "none open" from a device that can play', () => {
  const away = situation({ devices: [device('laptop', { online: false }), device('phone', { songs: 0 })] });
  it('says none is open only when this device has no music of its own either', () => {
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: away, cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn() }));
    act(() => { expect(hook.result.current.decide()).toBe(true); });
    expect(hook.result.current.notice?.text).toBe('None of your devices with music is open right now.');
  });

  it('plays here when this device has music the server has not counted yet', () => {
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: away, cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn(), playableHere: true }));
    act(() => { expect(hook.result.current.decide()).toBe(false); });
    expect(hook.result.current.notice).toBeNull();
  });

  it('cloud.catalogue_play: says nothing of the kind when this device can play the mix from the cloud library', () => {
    // this device is not in the list yet, and the laptop is away; the mix is in the cloud library
    const unlisted = situation({ devices: [device('laptop', { online: false })], mixIds: [1, 2], cloud: { ids: new Set([1, 2]), songs: 2 } });
    const hook = renderHook(() => useWhereToPlay({ enabled: true, situation: unlisted, cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn() }));
    act(() => { expect(hook.result.current.decide()).toBe(false); });
    expect(hook.result.current.notice).toBeNull();
  });

  it('takes the line down once this tab is the one playing', () => {
    const args = { enabled: true, situation: away, cloud: vi.fn() as never, playHere: vi.fn(), askToPlay: vi.fn(), refreshHoldings: vi.fn(), speakingHere: false };
    const hook = renderHook((props) => useWhereToPlay(props), { initialProps: args });
    act(() => { hook.result.current.decide(); });
    expect(hook.result.current.notice).not.toBeNull();
    act(() => { hook.rerender({ ...args, speakingHere: true }); });
    expect(hook.result.current.notice).toBeNull();
  });
});
