import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/** P0072 (ADR-0040): each song row keeps Play and keyboard reorder in view, groups the rarer
 * actions (lock, remove) in one keyboard-reachable menu, and keeps every insertion target. */
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

describe('P0072 grouped song actions', () => {
  it('keeps primary row actions direct and puts remove behind one More menu, without losing any', async () => {
    fakeBackend({});
    render(<Harness start={songs(seam('ready', 'a'), seam('ready', 'b'))} />);
    const row = screen.getByRole('button', { name: 'Play from Song 2' }).closest('li') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Move Song 2 up' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Move Song 2 down' })).toBeEnabled();
    // Remove is not a loose row button: it lives in the row's own menu
    expect(within(row).queryByRole('button', { name: 'Remove Song 2' })).toBeNull();
    const more = within(row).getByRole('button', { name: /More for Song 2/ });
    more.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Remove Song 2' })).toBeInTheDocument();
    // insertion stays available between songs, each naming where the song lands
    const targets = screen.getAllByRole('button', { name: /^Add a song after / });
    expect(targets.length).toBeGreaterThan(1);
    for (const target of targets) expect(target.getAttribute('title')).toMatch(/as number \d+/);
  });
});
