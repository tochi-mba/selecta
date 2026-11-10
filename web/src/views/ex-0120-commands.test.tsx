import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { orderOf } from '../state/readiness';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

// EX-0120-03: Clear stays one of the editor's whole-mix commands. It asks first, Keep
// changes nothing, and the clear itself is guarded by the exact order the listener saw.

function Harness({ start, notify }: { start: MixItem[]; notify: (message: string) => void }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={notify} stage={false} toggleStage={() => {}} />
  );
}

describe('EX-0120-03 Clear, a whole-mix command', () => {
  it('asks first; Keep sends nothing; Clear sends the order it saw and says so', async () => {
    const start = songs(seam('ready', 'a'), seam('ready', 'b'));
    const calls = fakeBackend({ 'POST /mix/clear': { mix: [], name: 'Test mix', can_undo: true } });
    const notify = vi.fn();
    render(<Harness start={start} notify={notify} />);

    await userEvent.click(screen.getByRole('button', { name: 'Clear', exact: true } as never));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep current mix' }));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Clear', exact: true } as never));
    await userEvent.click(await screen.findByRole('button', { name: 'Clear current mix' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Cleared the mix.', true));
    const sent = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/mix/clear'));
    expect((sent?.[1]?.headers as Record<string, string>)['x-mix-order']).toBe(orderOf(start));
  });
});
