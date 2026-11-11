import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/** GP-0250-06: a selected transition stays the exact pair it was, whatever else moves, and goes away
 * rather than jumping to a neighbour when its pair stops existing. */

let fromServer: (mix: MixItem[]) => void = () => {};

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  fromServer = setMix;
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix
      status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player}
      now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}}
    />
  );
}

const options = {
  moves: [{ name: 'bass_swap_blend', label: 'Blend', description: 'Swap the basslines.', available: true, reason: null }],
  exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'],
  studio: { available: false, reason: 'No stems yet.' },
};

const at = (item: MixItem, position: number, transition: MixItem['seam']): MixItem => ({ ...item, position, seam: transition });

async function selectSong2IntoSong3() {
  fakeBackend({ 'GET /mix/1/options': options, 'GET /mix/2/options': options, 'GET /mix/3/options': options });
  const all = songs(seam('ready', 'a'), seam('ready', 'b'), seam('ready', 'c'));
  render(<Harness start={all} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Hear it' })[1]);
  const side = screen.getByRole('complementary', { name: 'This transition' });
  expect(side.querySelector('audio')).toHaveAttribute('src', '/api/seams/b/preview');
  return all;
}

describe('GP-0250-06 a selected transition keeps its exact pair', () => {
  it('stays on Song 2 into Song 3 when the songs around it are reordered', async () => {
    const [one, two, three, four] = await selectSong2IntoSong3();
    act(() => fromServer([at(four, 0, null), at(two, 1, seam('ready', 'x')), at(three, 2, three.seam), at(one, 3, seam('ready', 'y'))]));
    const side = screen.getByRole('complementary', { name: 'This transition' });
    expect(within(side).getByText('Song 2')).toBeInTheDocument();
    expect(within(side).getByText('Song 3')).toBeInTheDocument();
    expect(side.querySelector('audio')).toHaveAttribute('src', '/api/seams/b/preview');
  });

  it('closes when Song 3 is deleted, instead of moving to Song 2 into whatever comes next', async () => {
    const [one, two, , four] = await selectSong2IntoSong3();
    act(() => fromServer([at(four, 0, null), at(two, 1, seam('ready', 'x')), at(one, 2, seam('ready', 'z'))]));
    expect(screen.queryByRole('complementary', { name: 'This transition' })).toBeNull();
    expect(document.querySelector('audio[src="/api/seams/z/preview"]')).toBeNull();
  });
});
