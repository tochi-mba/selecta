// S4-0092-05 / S4-0095-09: the transition inspector's resize handle works from the keyboard,
// stays inside a range that leaves the timeline usable, remembers its width, and a malformed or
// blocked saved width can neither crash the editor nor claim to have been kept.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
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

async function openInspector() {
  fakeBackend({ 'GET /mix/1/options': options });
  render(<Harness start={songs(seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend' }))} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
  return screen.getByRole('separator', { name: 'Resize inspector' });
}

describe('the inspector resize handle', () => {
  it('starts at the default width on a first visit, not squeezed to the minimum', async () => {
    const handle = await openInspector();
    expect(handle).toHaveAttribute('aria-valuenow', '380');
  });

  it('moves with the arrow keys, stops at Home and End, and remembers the width', async () => {
    const handle = await openInspector();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '396');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '520');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '520');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '320');
    expect(localStorage.getItem('selecta.inspectorWidth')).toBe('320');
  });

  it('keeps an out-of-range saved width inside the limits', async () => {
    localStorage.setItem('selecta.inspectorWidth', '4000');
    expect(await openInspector()).toHaveAttribute('aria-valuenow', '520');
  });

  it('ignores a malformed saved width', async () => {
    localStorage.setItem('selecta.inspectorWidth', 'wide');
    expect(await openInspector()).toHaveAttribute('aria-valuenow', '380');
  });

  it('still resizes when storage is blocked, without crashing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const handle = await openInspector();
    expect(handle).toHaveAttribute('aria-valuenow', '380');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '396');
    vi.restoreAllMocks();
  });
});
