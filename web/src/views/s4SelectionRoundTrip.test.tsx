import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/**
 * S4-0092-07: the open transition is remembered by the pair of songs it joins, for the life of the
 * app's one player. Leaving the editor for Library and coming back reopens that same transition, even
 * if the mix has moved around it, and a transition that has gone is never swapped for its neighbour.
 */
let player: SetPlayer;
function Editor({ mix }: { mix: MixItem[] }) {
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />
  );
}
const Library = () => <main><h1>Library</h1></main>;

const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };
const three = () => songs(seam('ready', 'a'), seam('ready', 'b'));
const pair = () => document.querySelector('.inspector-pair')?.textContent ?? '';

beforeEach(() => {
  player = new SetPlayer(() => [], () => {});
  fakeBackend({ 'GET /mix/1/options': options, 'GET /mix/2/options': options });
});

async function openSecondTransition() {
  const rows = [...document.querySelectorAll<HTMLElement>('li.seam')];
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Change' }));
  await screen.findByRole('complementary', { name: 'This transition' });
  expect(pair()).toMatch(/Song 2 .*into\s+Song 3/);
}

describe('S4-0092-07 the open transition survives a trip to Library', () => {
  it('coming back from Library reopens the same transition', async () => {
    const { rerender } = render(<Editor mix={three()} />);
    await openSecondTransition();
    rerender(<Library />);
    expect(screen.queryByRole('complementary', { name: 'This transition' })).toBeNull();
    rerender(<Editor mix={three()} />);
    expect(await screen.findByRole('complementary', { name: 'This transition' })).toBeInTheDocument();
    expect(pair()).toMatch(/Song 2 .*into\s+Song 3/);
  });

  it('follows the pair when a song was added in front of it while away', async () => {
    const { rerender } = render(<Editor mix={three()} />);
    await openSecondTransition();
    rerender(<Library />);
    const moved: MixItem[] = [
      { ...three()[0], position: 0, song_id: 9, title: 'Song 9', seam: null },
      ...three().map((item, index) => ({ ...item, position: index + 1, seam: index === 0 ? seam('ready', 'z') : item.seam })),
    ];
    rerender(<Editor mix={moved} />);
    expect(await screen.findByRole('complementary', { name: 'This transition' })).toBeInTheDocument();
    expect(pair()).toMatch(/Song 2 .*into\s+Song 3/);
  });

  it('a transition removed while away is not replaced by its neighbour', async () => {
    const { rerender } = render(<Editor mix={three()} />);
    await openSecondTransition();
    rerender(<Library />);
    // Song 3 was removed in Library, so the Song 2 into Song 3 transition no longer exists
    rerender(<Editor mix={songs(seam('ready', 'a'))} />);
    expect(pair()).not.toMatch(/Song 1 .*into Song 2/);
    expect(screen.queryByRole('complementary', { name: 'This transition' })).toBeNull();
    expect(screen.getByText(/Song 2 .*into Song 3/)).toHaveAttribute('role', 'status');
  });
});
