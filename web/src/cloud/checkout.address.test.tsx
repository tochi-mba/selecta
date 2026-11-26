import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { rememberPlanBeforeCheckout, useCheckoutReturn } from './checkout';

// Once the plan is confirmed the address is cleaned, so a reload does not start confirming again.
// It used to be cut back to the path alone, which also threw away every other parameter and the
// hash that were in it.

afterEach(() => {
  window.history.replaceState({}, '', '/');
  sessionStorage.clear();
});

describe('the address after a confirmed payment', () => {
  // this tab left for Stripe on Free; the webhook landed before the redirect came back
  beforeEach(() => { rememberPlanBeforeCheckout('free'); });

  it('loses only Stripe’s own parameters', async () => {
    window.history.replaceState({}, '', '/account/billing?checkout=success&session_id=cs_1&from=rooms#cloud-plan');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount({ plan: 'premium' }), async () => undefined));
    await waitFor(() => expect(result.current).toBe('confirmed'));
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/account/billing?from=rooms#cloud-plan');
  });

  it('is the path alone when nothing else was in it', async () => {
    window.history.replaceState({}, '', '/account/billing?checkout=success&session_id=cs_1');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount({ plan: 'standard' }), async () => undefined));
    await waitFor(() => expect(result.current).toBe('confirmed'));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/account/billing');
  });
});

describe('T-20261125-4001 an old success address on a paid account', () => {
  it('celebrates nothing, and the marker leaves the address', async () => {
    window.history.replaceState({}, '', '/account/billing?checkout=success&session_id=cs_old');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount({ plan: 'premium' }), async () => undefined));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(result.current).toBe('idle');
  });

  it('a return to the same paid plan this tab left on is not a change', async () => {
    rememberPlanBeforeCheckout('standard');
    window.history.replaceState({}, '', '/account/billing?checkout=success');
    const { result } = renderHook(() => useCheckoutReturn(cloudAccount({ plan: 'standard' }), async () => undefined, { everyMs: 60_000 }));
    expect(result.current).toBe('confirming');
  });
});
