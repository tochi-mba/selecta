import { connectMainPlayer } from '../audio/focus';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

/** ADR-0041 P0082 / P0083: a failed stem preparation can be retried in place, and the Studio says
 * which audio owns playback and what happens to the main mix when a preview stops. */
const deck = vi.hoisted(() => ({ made: [] as { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] }));

vi.mock('../studio', async (actual) => {
  const real = await actual<typeof import('../studio')>();
  return {
    ...real,
    StemDeck: class {
      shape: unknown;
      setShape = vi.fn();
      play = vi.fn(async () => {});
      stop = vi.fn();
      solo = vi.fn();
      close = vi.fn();
      load = vi.fn(async () => undefined);
      onCell: (cell: number) => void = () => {};
      constructor(_seconds: number, _cells: number, shape: unknown) {
        this.shape = shape;
        deck.made.push(this);
      }
    },
  };
});

const row = (value: number) => [value, value, value, value, value, value, value, value];
const shape = (a: number, b: number): Shape => ({
  a: { vocals: row(a), drums: row(a), bass: row(a), other: row(a) },
  b: { vocals: row(b), drums: row(b), bass: row(b), other: row(b) },
});
const ready = { status: 'ready', key: 'polish41', bars: 16, cells: 8, seconds: 32, start_shape: shape(1, 0), shape: null };

function open(answer: () => unknown) {
  const calls = fakeBackend({ 'POST /mix/1/studio': answer });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  render(<Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} notify={() => {}} />);
  return calls;
}

afterEach(() => {
  connectMainPlayer(null);
  deck.made.length = 0;
  window.localStorage.removeItem('selecta.studio.polish41');
});

describe('P0082 a failed stem preparation', () => {
  it('names the failure and Try again asks again for the same pair, then shows the grid', async () => {
    const answers: unknown[] = [{ status: 'failed', key: 'polish41', error: 'The stems could not be split.' }, ready];
    const calls = open(() => answers.shift() ?? ready);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The stems could not be split.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByRole('button', { name: /^Song 2 drums, bars? [0-9]/i })).length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.path === '/mix/1/studio')).toHaveLength(2);
  });
});

describe('P0083 preview audio ownership', () => {
  it('says the preview pauses the mix, pauses it on play, and leaves it paused after Stop', async () => {
    const pause = vi.fn();
    const resume = vi.fn();
    connectMainPlayer({ isPlaying: () => true, pause, resume });
    open(() => ready);
    await screen.findAllByRole('button', { name: /^Song 1 voice, bars? [0-9]/i });
    expect(screen.getByText(/Previewing pauses the main mix/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop preview' }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(deck.made.at(-1)!.stop).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(resume).not.toHaveBeenCalled();
  });
});
