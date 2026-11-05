import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Workshop } from './Workshop';

const GB = 1024 ** 3;
const storage = {
  used_bytes: 4.2 * GB,
  kept_bytes: 3.2 * GB,
  cache_bytes: 1 * GB,
  free_bytes: 13 * GB,
  budget_bytes: 3 * GB,
  largest_budget_bytes: 13 * GB,
  smallest_budget_bytes: 0.5 * GB,
  total_bytes: 200 * GB,
};

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Workshop
      status={status()}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={() => {}}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

describe('the storage slider', () => {
  it('moves the moment it’s dragged, before the server has answered', async () => {
    const calls = fakeBackend({ 'GET /storage': storage, 'POST /storage': { ...storage, budget_bytes: 5 * GB } });
    show();
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    expect(screen.getByText('5.0 GB')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ budget_gb: 5 }));
  });

  it('explains what’s used in plain words', async () => {
    fakeBackend({ 'GET /storage': storage });
    show();
    expect(await screen.findByText('Selecta is using 4.2 GB. Your drive has 13 GB free.')).toBeInTheDocument();
  });
});
