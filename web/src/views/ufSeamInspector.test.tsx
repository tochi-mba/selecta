import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/** UF-0381: the Seam Inspector names the exact directed pair in every tab, offers audition only for real
 * rendered audio, explains greyed-out moves and follows the APG tab keyboard pattern. */

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
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
  moves: [
    { name: 'bass_swap_blend', label: 'Blend', description: 'Swap the basslines.', available: true, reason: null },
    { name: 'vocal_ride', label: 'Vocal ride', description: '', available: false, reason: 'Song 2 has no clear vocal entry to ride into' },
  ],
  exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'],
};

async function open(item = seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend', preview_seam: 20 })) {
  fakeBackend({ 'GET /mix/1/options': options });
  render(<Harness start={songs(item)} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
  return screen.getByRole('complementary', { name: 'This transition' });
}

describe('UF-0381 Seam Inspector', () => {
  it('names the exact directed pair, its number and its mix in every tab', async () => {
    const side = await open();
    for (const tab of ['Listen', 'Change', 'Details']) {
      await userEvent.click(within(side).getByRole('tab', { name: tab }));
      const identity = side.querySelector('.inspector-identity') as HTMLElement;
      expect(identity).toHaveTextContent(/Song 1\s*→?\s*into\s*Song 2/);
      expect(within(identity).getByText('Transition 1')).toBeInTheDocument();
      expect(within(identity).getByText('In the current mix')).toBeInTheDocument();
    }
  });

  it('offers audition only for a rendered clip, and says honestly when there is nothing to hear', async () => {
    fakeBackend({ 'GET /mix/1/options': options });
    const { container } = render(<Harness start={songs(seam('none', 'b'))} />);
    expect(screen.queryByRole('button', { name: 'Hear it' })).toBeNull();
    await userEvent.click(container.querySelector('button.seam-name') as HTMLElement);
    const side = screen.getByRole('complementary', { name: 'This transition' });
    await userEvent.click(within(side).getByRole('tab', { name: 'Listen' }));
    expect(side.querySelector('audio')).toBeNull();
    expect(within(side).getByText(/hasn’t been rendered yet/)).toBeInTheDocument();
  });

  it('shows the moves this pair allows and says why the others cannot be chosen', async () => {
    const side = await open();
    await userEvent.click(within(side).getByRole('tab', { name: 'Change' }));
    expect(await within(side).findByRole('button', { name: 'Vocal ride' })).toBeDisabled();
    expect(within(side).getByRole('button', { name: 'Blend' })).toBeEnabled();
    expect(within(side).getByText(/Why one move is greyed out/)).toBeInTheDocument();
    expect(within(side).getByText(/no clear vocal entry to ride into/)).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    const side = await open();
    const listen = within(side).getByRole('tab', { name: 'Listen' });
    listen.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(side).getByRole('tab', { name: 'Change' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    const tabs = within(side).getAllByRole('tab');
    expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await userEvent.keyboard('{Home}');
    expect(within(side).getByRole('tab', { name: 'Listen' })).toHaveAttribute('aria-selected', 'true');
  });
  it('gives focus back to the exact transition it was opened from when closed', async () => {
    const side = await open();
    await userEvent.click(within(side).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'This transition' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toHaveClass('seam-name'));
    expect(document.activeElement?.closest('[data-seam]')).not.toBeNull();
  });
});
