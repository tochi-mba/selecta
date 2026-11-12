import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StoragePanel } from './WorkshopPanels';

// T0233: a slow, older storage write can't overwrite the newer limit, and writes go one at a time.
const GB = 1024 ** 3;
const storage = (budget: number) => ({
  used_bytes: 4 * GB, kept_bytes: 3 * GB, cache_bytes: 1 * GB, free_bytes: 13 * GB,
  budget_bytes: budget * GB, largest_budget_bytes: 13 * GB, smallest_budget_bytes: 0.5 * GB, total_bytes: 200 * GB,
});

describe('T0233 stale storage write', () => {
  it('serialises writes and shows only the newest confirmed limit', async () => {
    const sent: number[] = [];
    let inFlight = 0;
    let most = 0;
    let releaseFirst: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes('/storage')) return new Response('{}', { status: 200 });
      if (init?.method !== 'POST') return new Response(JSON.stringify(storage(3)), { status: 200 });
      const { budget_gb: budget } = JSON.parse(String(init.body)) as { budget_gb: number };
      sent.push(budget);
      inFlight += 1;
      most = Math.max(most, inFlight);
      if (budget === 5) await new Promise<void>((done) => { releaseFirst = done; });
      inFlight -= 1;
      return new Response(JSON.stringify(storage(budget)), { status: 200 });
    }));
    render(<StoragePanel />);
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    await waitFor(() => expect(sent).toEqual([5]), { timeout: 2000 });
    fireEvent.change(slider, { target: { value: '8' } });
    await new Promise((done) => setTimeout(done, 600));
    expect(sent).toEqual([5]);
    releaseFirst();
    await waitFor(() => expect(sent).toEqual([5, 8]), { timeout: 2000 });
    await waitFor(() => expect(slider).toHaveValue('8'));
    expect(screen.getAllByText('8.0 GB').length).toBeGreaterThan(0);
    expect(most).toBe(1);
    vi.unstubAllGlobals();
  });
});
