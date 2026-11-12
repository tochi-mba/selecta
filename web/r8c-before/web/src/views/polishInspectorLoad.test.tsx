import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/** P0077 (ADR-0040): a transition's options that fail to load say so, with a retry, instead of
 * an empty or stale panel; the retry fetches the same exact pair. */
function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix
      status={status()} mix={mix} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}}
      player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}}
    />
  );
}

const options = {
  moves: [{ name: 'bass_swap_blend', label: 'Blend', description: 'Swap the basslines.', available: true, reason: null }],
  exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'],
};

describe('P0077 failed loading in the transition inspector', () => {
  it('shows the failure with a retry, and the retry loads the same pair', async () => {
    let fail = true;
    const calls = fakeBackend({
      'GET /mix/1/options': () => (fail ? new Reply(500, { detail: 'The server could not work out the moves.' }) : options),
    });
    render(<Harness start={songs(seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend', preview_seam: 20 }))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const side = screen.getByRole('complementary', { name: 'This transition' });
    await userEvent.click(within(side).getByRole('tab', { name: 'Change' }));
    const alert = await within(side).findByRole('alert');
    expect(alert).toHaveTextContent('The server could not work out the moves.');
    expect(within(side).queryByRole('button', { name: 'Blend' })).toBeNull();
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(side).findByRole('button', { name: 'Blend' })).toBeEnabled();
    expect(calls.filter((call) => call.path.startsWith('/mix/1/options')).length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => !call.path.startsWith('/mix/2/options'))).toBe(true);
  });
});
