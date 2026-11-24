import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { useCheckoutReturn } from './checkout';

// Once the plan is confirmed the address is cleaned, so a reload does not start confirming again.
// It used to be cut back to the path alone, which also threw away every other parameter and the
// hash that were in it.

afterEach(() => { window.history.replaceState({}, '', '/'); });

describe('the address after a confirmed payment', () => {
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
