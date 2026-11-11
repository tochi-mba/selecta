// S4-0100-06: "Jump to first problem" goes to the actual failed or cut-off transition, not the
// first one, and is only offered while there is a problem to go to.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
  return (
    <Mix
      status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player}
      now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}}
    />
  );
}

const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };

describe('jumping to the first problem', () => {
  it('opens the failed transition itself, on its Change tab', async () => {
    fakeBackend({ 'GET /mix/2/options': options, 'GET /mix/1/options': options });
    render(<Harness start={songs(seam('ready', 'a'), seam('failed', 'b', { passed: false }), seam('ready', 'c'))} />);
    await userEvent.click(screen.getByRole('button', { name: /Jump to first problem/ }));
    const side = await screen.findByRole('complementary', { name: 'This transition' });
    expect(within(side).getAllByText('Song 2').length).toBeGreaterThan(0);
    expect(within(side).getAllByText('Song 3').length).toBeGreaterThan(0);
    expect(within(side).queryByText('Song 1')).toBeNull();
    expect(within(side).getByRole('tab', { name: 'Change' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is not offered when every transition is fine', () => {
    render(<Harness start={songs(seam('ready', 'a'), seam('ready', 'b'))} />);
    expect(screen.queryByRole('button', { name: /Jump to first problem/ })).toBeNull();
  });
});
