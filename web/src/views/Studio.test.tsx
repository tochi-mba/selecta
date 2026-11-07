import { connectMainPlayer } from '../audio/focus';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

const deck = vi.hoisted(() => ({
  made: [] as { shape: unknown; setShape: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; solo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>; onCell: (cell: number) => void }[],
}));

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
      load = vi.fn(async () => {});
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
const ready = {
  status: 'ready',
  key: 'abc',
  bars: 16,
  cells: 8,
  seconds: 32,
  start_shape: shape(1, 0),
  shape: null,
};

function open(answer: unknown = ready, more: Record<string, unknown> = {}) {
  const calls = fakeBackend({ 'POST /mix/1/studio': answer, ...more });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  const onClose = vi.fn();
  const onUsed = vi.fn();
  const notify = vi.fn();
  const onListen = vi.fn();
  render(<Studio position={1} item={item} previous={previous} onClose={onClose} onUsed={onUsed} onListen={onListen} notify={notify} />);
  return { calls, onClose, onUsed, notify, onListen };
}

const square = (name: string) => screen.findByRole('button', { name });

describe('the seam studio', () => {
  beforeEach(() => {
    deck.made.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says how long the stems will take while they are split, and that the mix keeps playing', async () => {
    open({ status: 'queued', key: 'abc', eta: { seconds: 280, low: 200, high: 400 } });
    const message = await screen.findByRole('status');
    expect(message).toHaveTextContent('about 5 minutes');
    expect(message).toHaveTextContent('Your mix keeps playing');
  });

  it('keeps asking until the stems are ready, then shows the grid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [{ status: 'rendering', key: 'abc', eta: { seconds: 20, low: 10, high: 30 } }, ready];
    const calls = fakeBackend({ 'POST /mix/1/studio': () => answers.shift() ?? ready });
    const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
    render(<Studio position={1} item={item} previous={previous} onClose={() => {}} onUsed={() => {}} notify={() => {}} />);
    await screen.findByRole('status');
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    await square('Song 2 drums, square 1');
    expect(calls.filter((call) => call.path === '/mix/1/studio')).toHaveLength(2);
  });

  it('shows a square for every part of both songs, named for a screen reader', async () => {
    open();
    await square('Song 1 voice, square 1');
    expect(screen.getByRole('button', { name: 'Song 2 melody, square 8' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /square \d/ })).toHaveLength(64);
  });

  it('tapping a square is heard straight away and renders nothing', async () => {
    const { calls } = open();
    const cell = await square('Song 2 drums, square 3');
    expect(cell).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    expect(deck.made[0].setShape).toHaveBeenCalledTimes(1);
    const sent = deck.made[0].setShape.mock.calls[0][0] as Shape;
    expect(sent.b.drums[2]).toBe(1);
    expect(sent.b.drums[1]).toBe(0);
    expect(calls.filter((call) => call.path.endsWith('/use'))).toHaveLength(0);
  });

  it('tapping twice puts it back', async () => {
    open();
    const cell = await square('Song 1 bass, square 1');
    fireEvent.click(cell);
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-pressed', 'true');
  });

  it('play and stop, and it pauses the mix when it plays', async () => {
    const pause = vi.fn();
    connectMainPlayer({ isPlaying: () => true, pause, resume: vi.fn() });
    open();
    await square('Song 1 voice, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    expect(await screen.findByRole('button', { name: 'Stop preview' })).toBeInTheDocument();
    expect(deck.made[0].play).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    connectMainPlayer(null);
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
    expect(deck.made[0].stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('pressing a name plays only that part, and can go back to everything', async () => {
    open();
    await square('Song 1 voice, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Hear only Song 1 voice' }));
    expect(deck.made[0].solo).toHaveBeenLastCalledWith('a_vocals');
    expect(screen.getByRole('button', { name: 'Hear only Song 1 voice' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await screen.findByRole('button', { name: 'Hear everything again' }));
    expect(deck.made[0].solo).toHaveBeenLastCalledWith(null);
  });

  it('marks the square being played', async () => {
    open();
    const cell = await square('Song 1 drums, square 2');
    act(() => deck.made[0].onCell(1));
    expect(cell).toHaveClass('now');
    expect(screen.getByRole('button', { name: 'Song 1 drums, square 3' })).not.toHaveClass('now');
  });

  it('starts from the shape already chosen when coming back to a seam', async () => {
    open({ ...ready, shape: shape(0, 1) });
    expect(await square('Song 2 bass, square 1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Song 1 bass, square 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('ready-made shapes change the grid, and it can start again', async () => {
    open();
    const cell = await square('Song 1 voice, square 8');
    const shapes = within(screen.getByRole('group', { name: 'Ready-made shapes' }));
    const before = deck.made[0].setShape.mock.calls.length;
    fireEvent.click(shapes.getAllByRole('button')[0]);
    expect(deck.made[0].setShape.mock.calls.length).toBe(before + 1);
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(cell).toHaveAttribute('aria-pressed', 'true');
  });

  it('using it saves the shape, closes and says what happens next', async () => {
    const data = { mix: songs(), name: 'Mix', can_undo: true };
    const { calls, onClose, onUsed, notify } = open(ready, { 'POST /mix/1/studio/use': data });
    const cell = await square('Song 2 voice, square 1');
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this transition' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = calls.find((call) => call.path.endsWith('/use'))?.body as { shape: Shape };
    expect(body.shape.b.vocals[0]).toBe(1);
    expect(onUsed).toHaveBeenCalledWith(data);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Rendering your version'));
    expect(deck.made[0].stop).toHaveBeenCalled();
  });

  it('if using it fails, the shape is still there to try again', async () => {
    const { onClose } = open();
    const cell = await square('Song 2 voice, square 1');
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this transition' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Song 2 voice, square 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains a failure in the words it was given', async () => {
    open({ status: 'failed', key: 'abc', error: 'These two are 30% apart in tempo.' });
    expect(await screen.findByRole('alert')).toHaveTextContent('30% apart');
  });

  it('closing lets go of the audio', async () => {
    const { onClose } = open();
    await square('Song 1 voice, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lets Selecta arrange it, and what was there can be put back', async () => {
    const made = shape(0, 1);
    const { calls } = open(ready, { 'POST /mix/1/studio/tune': { shape: made, changes: [] } });
    const cell = await square('Song 2 bass, square 1');
    expect(cell).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Let Selecta arrange it' }));
    await waitFor(() => expect(cell).toHaveAttribute('aria-pressed', 'true'));
    expect(calls.find((call) => call.path.endsWith('/tune'))?.body).toEqual({ shape: null });
    expect(deck.made[0].setShape).toHaveBeenLastCalledWith(made);
    expect(screen.getByText('Selecta arranged this from what’s in the stems.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    expect(cell).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
  });

  it('fine tunes your own grid and says what it changed and why', async () => {
    const tuned = shape(1, 1);
    const { calls } = open(ready, {
      'POST /mix/1/studio/tune': { shape: tuned, changes: ['Turned Song 2’s melody off in square 4, where it clashed with the other song.'] },
    });
    const cell = await square('Song 2 bass, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Fine tune mine' }));
    await waitFor(() => expect(cell).toHaveAttribute('aria-pressed', 'true'));
    expect((calls.find((call) => call.path.endsWith('/tune'))?.body as { shape: Shape }).shape.a.vocals[0]).toBe(1);
    expect(screen.getByText(/where it clashed/)).toBeInTheDocument();
  });

  it('says so when fine tuning finds nothing to change', async () => {
    open(ready, { 'POST /mix/1/studio/tune': { shape: shape(1, 0), changes: [] } });
    await square('Song 2 bass, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Fine tune mine' }));
    expect(await screen.findByText(/Nothing to change/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
  });

  it('a change of your own clears what fine tuning said', async () => {
    open(ready, { 'POST /mix/1/studio/tune': { shape: shape(1, 1), changes: ['Something.'] } });
    const cell = await square('Song 2 bass, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Fine tune mine' }));
    await screen.findByText('Something.');
    fireEvent.click(cell);
    expect(screen.queryByText('Something.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
  });

  it('explains when Selecta can’t arrange these two, and keeps the grid as it is', async () => {
    open();
    const cell = await square('Song 1 voice, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Let Selecta arrange it' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Let Selecta arrange it' })).toBeEnabled();
  });

  it('nothing it does is final until “Apply to this transition”', async () => {
    const { calls } = open(ready, { 'POST /mix/1/studio/tune': { shape: shape(1, 1), changes: ['x'] } });
    await square('Song 1 voice, square 1');
    fireEvent.click(screen.getByRole('button', { name: 'Fine tune mine' }));
    await screen.findByText('x');
    expect(calls.some((call) => call.path.endsWith('/use'))).toBe(false);
  });
});
