import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { songs } from '../test/backend';
import { CurrentMix } from './CurrentMix';

describe('current mix identity', () => {
  it('tracks the exact returned song order without adding an audio action', () => {
    const original = songs(null, null);
    const player = new SetPlayer(() => original, () => {});
    const view = (mix: typeof original) => (
      <CurrentMix mix={mix} mixName="A real set" player={player} now={player.state}
        setView={vi.fn()} prominent />
    );
    const { container, rerender } = render(view(original));
    const initial = container.querySelector('.mix-signature')?.innerHTML;
    expect(initial).toBeTruthy();
    expect(screen.getByText(/decorative, not an audio waveform/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current mix' })).toBeInTheDocument();

    rerender(view(original.map((song, index) => ({
      ...song, song_id: original[(index + 1) % original.length].song_id,
    }))));
    expect(container.querySelector('.mix-signature')?.innerHTML).not.toBe(initial);
    expect(player.state.phase).toBe('idle');
  });
});
