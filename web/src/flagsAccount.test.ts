import { afterEach, describe, expect, it, vi } from 'vitest';
import { flagOn, gateOpen, onFlagsChange, setAccountFeatures, setFlags } from './flags';

// BF-0462-03: one flag read in both modes. Local feeds /api/status; Cloud feeds the account's
// features snapshot; flagOn, Gate and the shell read the merge.

afterEach(() => {
  setAccountFeatures(null);
  setFlags({});
});

describe('the one flag read', () => {
  it('reads exactly as before when no account has been fed (local mode)', () => {
    setFlags({ requests: false });
    expect(flagOn('requests')).toBe(false);
    expect(flagOn('lucy')).toBe(true);
  });

  it('gates on the account in Cloud, and a flag the account does not mention is on', () => {
    setFlags(null);
    setAccountFeatures({ rooms: false, devices: true });
    expect(flagOn('rooms')).toBe(false);
    expect(flagOn('devices')).toBe(true);
    expect(flagOn('lucy')).toBe(true);
    expect(gateOpen({ flag: ['devices', 'rooms'] })).toBe(false);
  });

  it('needs both sources to allow a feature when both have spoken', () => {
    setFlags({ requests: false });
    setAccountFeatures({ rooms: false });
    expect(flagOn('requests')).toBe(false);
    expect(flagOn('rooms')).toBe(false);
    expect(flagOn('devices')).toBe(true);
  });

  it('reflows live: a refreshed account tells listeners, an identical one does not', () => {
    const heard = vi.fn();
    const stop = onFlagsChange(heard);
    try {
      setAccountFeatures({ rooms: true });
      setAccountFeatures({ rooms: true });
      setAccountFeatures({ rooms: false });
      expect(heard).toHaveBeenCalledTimes(2);
      expect(flagOn('rooms')).toBe(false);
    } finally { stop(); }
  });

  it('forgets the account on sign-out, so nothing gates on a stale account', () => {
    setAccountFeatures({ rooms: false });
    setAccountFeatures(null);
    expect(flagOn('rooms')).toBe(true);
  });

  it('keeps the account when the status source forgets', () => {
    setAccountFeatures({ rooms: false });
    setFlags(null);
    expect(flagOn('rooms')).toBe(false);
  });
});
