import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
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
    expect(screen.getByText('laptop didn’t answer.')).toBeInTheDocument();
    act(() => { screen.getByRole('button', { name: 'Try again' }).click(); });
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
