import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, Reply, songs } from '../test/backend';
import { Shape } from '../studio';
import { Studio } from './Studio';

// Selecta 4.0 ADR-0102 negative cases: missing stems (S4-0102-04), dirty/applied state
// (S4-0102-06), recovery validation and blocked storage (S4-0102-07), late suggestions
// (S4-0102-08) and a failed Apply that keeps the working copy (S4-0102-09).

const deck = vi.hoisted(() => ({
  missing: [] as string[],
  made: [] as { shape: unknown; setShape: ReturnType<typeof vi.fn>; solo: ReturnType<typeof vi.fn> }[],
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
      load = vi.fn(async () => [...deck.missing]);
      onCell: (cell: number) => void = () => {};
      constructor(_seconds: number, _cells: number, shape: unknown) {
        this.shape = shape;
        deck.made.push(this);
      }
    },
  };
});

const row = (value: number, cells = 8) => Array.from({ length: cells }, () => value);
const shape = (a: number, b: number, cells = 8): Shape => ({
  a: { vocals: row(a, cells), drums: row(a, cells), bass: row(a, cells), other: row(a, cells) },
  b: { vocals: row(b, cells), drums: row(b, cells), bass: row(b, cells), other: row(b, cells) },
});
const ready = { status: 'ready', key: 'abc', bars: 16, cells: 8, seconds: 32, start_shape: shape(1, 0), shape: null };

function open(more: Record<string, unknown> = {}) {
  const calls = fakeBackend({ 'POST /mix/1/studio': ready, ...more });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  const onClose = vi.fn();
  const onUsed = vi.fn();
  render(<Studio position={1} item={item} previous={previous} onClose={onClose} onUsed={onUsed} notify={() => {}} />);
  return { calls, onClose, onUsed };
}

// A cold first render on a busy machine can take longer than findBy's 1 s default.
const first = (part: string) => screen.findAllByRole('button', { name: new RegExp('^' + part + ', bars? 1') }, { timeout: 8000 }).then((all) => all[0]);

describe('Studio safety cases', () => {
  beforeEach(() => {
    deck.made.length = 0;
    deck.missing = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem('selecta.studio.abc');
  });

  it('a stem that could not load is named, disabled and cannot be toggled or soloed', async () => {
    deck.missing = ['b_bass'];
    open();
    const lost = await first('Song 2 bass');
    expect(await screen.findByText(/Couldn’t load Song 2 bass/)).toBeInTheDocument();
    expect(lost).toHaveAttribute('aria-disabled', 'true');
    const before = deck.made[0].setShape.mock.calls.length;
    fireEvent.click(lost);
    expect(lost).toHaveAttribute('aria-pressed', 'false');
    expect(deck.made[0].setShape.mock.calls.length).toBe(before);
    const soloLost = screen.getByRole('button', { name: 'Hear only Song 2 bass, unavailable' });
    fireEvent.click(soloLost);
    expect(deck.made[0].solo).not.toHaveBeenCalled();
    // the parts that did load still work
    const fine = await first('Song 2 drums');
    fireEvent.click(fine);
    expect(fine).toHaveAttribute('aria-pressed', 'true');
  });

  it('says plainly when the working copy differs from what is applied and rendered', async () => {
    open();
    const cell = await first('Song 2 voice');
    expect(screen.getByText('Same as what’s applied')).toBeInTheDocument();
    fireEvent.click(cell);
    expect(screen.getByText('Changed, not applied yet')).toBeInTheDocument();
    expect(screen.getByText(/Unsaved changes - not applied to the mix/)).toBeInTheDocument();
    expect(screen.getByText('Selecta’s starting shape')).toBeInTheDocument();
  });

  it('never recovers a working copy with a different cell count (a 64-cell draft into an 8-cell pair)', async () => {
    window.localStorage.setItem('selecta.studio.abc', JSON.stringify(shape(0, 1, 64)));
    open();
    expect(await first('Song 1 voice')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Nothing to recover')).toBeInTheDocument();
    expect(deck.made[0].shape).toEqual(ready.start_shape);
  });

  it('never recovers non-binary values or a working copy that is not JSON', async () => {
    for (const raw of ['{broken', JSON.stringify({ ...shape(0, 1), a: { ...shape(0, 1).a, vocals: row(2) } })]) {
      deck.made.length = 0;
      window.localStorage.setItem('selecta.studio.abc', raw);
      const view = open();
      expect(await first('Song 1 voice')).toHaveAttribute('aria-pressed', 'true');
      expect(deck.made[0].shape).toEqual(ready.start_shape);
      expect(view.calls.some((call) => call.path.endsWith('/use'))).toBe(false);
      document.body.innerHTML = '';
    }
  });

  it('warns instead of promising recovery when this browser cannot store the working copy', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    open();
    fireEvent.click(await first('Song 2 voice'));
    expect(await screen.findByText(/could not keep a local copy/)).toBeInTheDocument();
    expect(screen.queryByText(/Your work is kept on this browser/)).toBeNull();
  });

  it('a suggestion that arrives after a manual edit never replaces the newer edit', async () => {
    let answer: (value: Response) => void = () => {};
    open({ 'POST /mix/1/studio/tune': { shape: shape(0, 0), changes: ['late'] } });
    const backend = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (
      url.endsWith('/studio/tune') ? new Promise<Response>((resolve) => { answer = resolve; }) : backend(url, init)
    )));
    const cell = await first('Song 2 voice');
    fireEvent.click(screen.getByRole('button', { name: 'Let Selecta arrange it' }));
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { answer(new Response(JSON.stringify({ shape: shape(0, 0), changes: ['late'] }), { status: 200 })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Let Selecta arrange it' })).toBeEnabled());
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    expect(await first('Song 1 voice')).toHaveAttribute('aria-pressed', 'true');
    expect(deck.made[0].setShape).not.toHaveBeenCalledWith(shape(0, 0));
    expect(screen.queryByText('late')).toBeNull();
  });

  it('a failed Apply keeps the working copy in place and in this browser', async () => {
    const { onClose, onUsed } = open({ 'POST /mix/1/studio/use': new Reply(504, { detail: 'The server took too long.' }) });
    const cell = await first('Song 2 voice');
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this transition' }));
    expect(await screen.findByText('The server took too long.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onUsed).not.toHaveBeenCalled();
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    const kept = JSON.parse(window.localStorage.getItem('selecta.studio.abc') ?? 'null') as Shape;
    expect(kept.b.vocals[0]).toBe(1);
    expect(screen.getByText('Changed, not applied yet')).toBeInTheDocument();
  });

  it('an Apply into a pair that changed sends nothing and keeps the working copy', async () => {
    let asked = 0;
    const { calls, onUsed } = open({ 'POST /mix/1/studio': () => (asked++ === 0 ? ready : { ...ready, key: 'other-pair' }) });
    const cell = await first('Song 2 voice');
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this transition' }));
    expect(await screen.findByText(/This transition has changed since the Studio opened/)).toBeInTheDocument();
    expect(calls.some((call) => call.path.endsWith('/use'))).toBe(false);
    expect(onUsed).not.toHaveBeenCalled();
    expect(cell).toHaveAttribute('aria-pressed', 'true');
  });
});
