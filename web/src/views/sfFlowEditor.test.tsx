import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem, Status } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

function Harness({ start, state = status() }: { start: MixItem[]; state?: Status }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
  return (
    <Mix status={state} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player}
      now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

const titles = () => Array.from(document.querySelectorAll('.timeline .song .song-name b')).map((node) => node.textContent);

// SF-0220-05: moving a song past a locked one is refused out loud, and the timeline stays as it was.
describe('SF-0220-05 locked positions', () => {
  it('says why a move past a locked song did nothing, and leaves every row where it was', async () => {
    const start = songs(seam('ready', 'a'), seam('ready', 'b')).map((item) => (item.position === 1 ? { ...item, locked: true } : item));
    const calls = fakeBackend({
      'POST /mix/move': new Reply(409, { detail: 'Song 2 is locked, so it stays where it is and nothing moved. Unlock it first to move songs past it.' }),
      'GET /mix': { mix: start, name: 'Test mix', can_undo: false },
    });
    render(<Harness start={start} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    const before = titles();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Song 1' }), { key: 'ArrowDown' });
    expect(await screen.findByText(/Song 2 is locked, so it stays where it is and nothing moved/)).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((call) => call.path === '/mix/move')).toHaveLength(1));
    expect(titles()).toEqual(before);
  });
});
