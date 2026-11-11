import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, status } from '../test/backend';
import { Workshop } from './Workshop';

/* Selecta 2.0 T0096 (ADR-0028): a storage limit changed in another window is shown, not overwritten. */

const GB = 1024 ** 3;

const storage = (budget: number) => ({
  used_bytes: 6 * GB, kept_bytes: 2 * GB, cache_bytes: 1 * GB, free_bytes: 13 * GB, budget_bytes: budget * GB,
  largest_budget_bytes: 13 * GB, smallest_budget_bytes: 0.5 * GB, total_bytes: 200 * GB,
});

function show() {
  const player = new SetPlayer(() => [], () => {});
  return render(
    <Workshop tab="storage" status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

describe('T0096 setting conflicts', () => {
  it('sends the limit it last saw with every change', async () => {
    const calls = fakeBackend({ 'GET /storage': storage(3), 'POST /storage': storage(5) });
    show();
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '5' } });
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ budget_gb: 5, expected_budget_bytes: 3 * GB }));
  });

  it('a limit changed elsewhere is reported and then shown, instead of being replaced', async () => {
    let current = 3;
    const calls = fakeBackend({
      'GET /storage': () => storage(current),
      'POST /storage': () => {
        current = 8; // another window got there first
        return new Reply(409, {
          detail: 'The storage limit was changed somewhere else to 8.0 GB, so it wasn’t changed here. Choose again if you still want a different limit.',
          code: 'setting_changed', budget_bytes: 8 * GB,
        });
      },
    });
    show();
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '5' } });
    expect(await screen.findByText(/changed somewhere else to 8\.0 GB/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('8'));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
});
