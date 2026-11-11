import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { Shape } from '../studio';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';
import { MixSetup } from './MixSetup';
import { Studio } from './Studio';

/**
 * SF-0243-02 provisional visuals: a drag or a move on its way is drawn apart from the committed
 * result, and nothing is committed until the gesture ends and the server answers.
 * SF-0243-03 cancel paths: Escape, a cancelled pointer and leaving the page put things back.
 * SF-0243-05 touch boundaries: the stylesheet gives each surface its own gesture contract.
 */

vi.mock('../studio', async (actual) => {
  const real = await actual<typeof import('../studio')>();
  return {
    ...real,
    StemDeck: class {
      setShape = vi.fn();
      play = vi.fn(async () => {});
      stop = vi.fn();
      solo = vi.fn();
      close = vi.fn();
      load = vi.fn(async () => undefined);
      onCell: (cell: number) => void = () => {};
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.removeItem('selecta.studio.sf0243');
});

// ---- the timeline ----------------------------------------------------------------------------

function Timeline({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={(() => {}) as never} stage={false} toggleStage={() => {}} />
  );
}

const ready = (key: string) => seam('ready', key, { label: 'Blend', style: 'bass_swap_blend' });
const start = songs(ready('a'), ready('b'));
const titles = () => [...document.querySelectorAll('li.song[data-song-key]')].map((row) => row.querySelector('.song-select')?.textContent);
const moved = (from: number, to: number): MixData => {
  const order = [...start];
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return { mix: order.map((song, position) => ({ ...song, position, seam: position === 0 ? null : song.seam ?? ready(`n${position}`) })), name: 'Test mix', can_undo: true } as unknown as MixData;
};

/** A server that holds the move until the test lets it answer. */
function slowMove() {
  const calls: { method: string; path: string }[] = [];
  let answer: (() => void) | null = null;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    if (method === 'POST' && path.startsWith('/mix/move')) {
      return new Promise<Response>((resolve) => {
        answer = () => resolve(new Response(JSON.stringify(moved(2, 1)), { status: 200 }));
      });
    }
    return Promise.resolve(new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 }));
  }));
  return { calls, answer: () => answer?.() };
}

describe('SF-0243-02 provisional visuals', () => {
  it('marks a song as moving while a slow server works, and only shows it moved once the server says so', async () => {
    const server = slowMove();
    render(<Timeline start={start} />);
    screen.getByRole('button', { name: 'Reorder Song 3' }).focus();
    await userEvent.keyboard('{ArrowUp}');
    const row = () => screen.getByRole('button', { name: 'Reorder Song 3' }).closest('li')!;
    await waitFor(() => expect(row()).toHaveAttribute('data-moving'));
    expect(row()).toHaveAttribute('aria-busy', 'true');
    expect(row()).toHaveTextContent('Moving…');
    // still where it really is: the server hasn't answered
    expect(titles()).toEqual(['Song 1', 'Song 2', 'Song 3']);
    await act(async () => server.answer());
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 3', 'Song 2']));
    expect(row()).not.toHaveAttribute('data-moving');
    expect(row()).not.toHaveTextContent('Moving…');
  });

  it('draws the energy arc as a sketch while it is being drawn, and saves nothing until the stroke ends', async () => {
    const calls = fakeBackend({ 'POST /steer': {} });
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    const graphic = screen.getByRole('img', { name: /Draw energy arc/ });
    vi.spyOn(graphic, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 40 } as DOMRect);
    Object.defineProperty(graphic, 'setPointerCapture', { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(graphic, { pointerId: 5, isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    expect(graphic).toHaveAttribute('data-provisional', 'true');
    expect(screen.getByText(/Drawing\. Nothing is saved until you let go/)).toBeInTheDocument();
    // well past the save delay, still nothing sent while the finger is down
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    fireEvent.pointerUp(graphic, { pointerId: 5, isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    expect(graphic).not.toHaveAttribute('data-provisional');
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST' && call.path === '/steer')).toHaveLength(1));
    expect((calls.find((call) => call.path === '/steer')?.body as { action: string; value: number[] }).value[0]).toBe(100);
  });
});

// ---- cancel paths ------------------------------------------------------------------------------

const lane = (value: number) => [value, value, value, value, value, value, value, value];
const flat = (a: number, b: number): Shape => ({
  a: { vocals: lane(a), drums: lane(a), bass: lane(a), other: lane(a) },
  b: { vocals: lane(b), drums: lane(b), bass: lane(b), other: lane(b) },
});

function openStudio() {
  fakeBackend({ 'POST /mix/1/studio': { status: 'ready', key: 'sf0243', bars: 16, cells: 8, seconds: 32, start_shape: flat(1, 0), shape: null } });
  const [previous, item] = songs({ settings: {}, state: { status: 'none', key: 'x' } });
  return render(<Studio position={1} item={item} previous={previous} onClose={vi.fn()} onUsed={vi.fn()} onListen={vi.fn()} notify={vi.fn()} />);
}

const square = async (part: string, position: number) =>
  (await screen.findAllByRole('button', { name: new RegExp('^' + part + ', bars? [0-9]', 'i') }))[position - 1];

/** Starts a touch stroke on `first` that passes over `second`. */
function strokeOver(first: Element, second: Element) {
  const grid = screen.getByRole('grid');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => second });
  fireEvent.pointerDown(first, { pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(grid, { pointerId: 31, pointerType: 'touch', isPrimary: true, buttons: 1, clientX: 50, clientY: 10 });
  return grid;
}

describe('SF-0243-03 cancel paths', () => {
  let prior: typeof document.elementFromPoint;
  beforeEach(() => {
    prior = document.elementFromPoint;
  });
  afterEach(() => {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: prior });
  });

  it('a cancelled pointer puts back every square the stroke touched, and keeps earlier work', async () => {
    openStudio();
    const earlier = await square('Song 1 drums', 1);
    fireEvent.click(earlier);
    expect(earlier).toHaveAttribute('aria-pressed', 'false');
    const first = await square('Song 1 voice', 1);
    const second = await square('Song 1 voice', 2);
    const grid = strokeOver(first, second);
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    fireEvent.pointerCancel(grid, { pointerId: 31, pointerType: 'touch' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(earlier).toHaveAttribute('aria-pressed', 'false');
  });

  it('Escape in the middle of a stroke puts it back; a stroke that ends normally stays', async () => {
    openStudio();
    const first = await square('Song 1 voice', 1);
    const second = await square('Song 1 voice', 2);
    const grid = strokeOver(first, second);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    // a later pointer up from the cancelled stroke changes nothing
    fireEvent.pointerUp(grid, { pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0 });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    strokeOver(first, second);
    fireEvent.pointerUp(grid, { pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0 });
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaving the page mid-stroke keeps the grid as it was before the stroke', async () => {
    const view = openStudio();
    const earlier = await square('Song 1 drums', 1);
    fireEvent.click(earlier);
    strokeOver(await square('Song 1 voice', 1), await square('Song 1 voice', 2));
    view.unmount();
    const kept = JSON.parse(window.localStorage.getItem('selecta.studio.sf0243') ?? 'null') as Shape;
    expect(kept.a.drums[0]).toBe(0);
    expect(kept.a.vocals[0]).toBe(1);
    expect(kept.a.vocals[1]).toBe(1);
  });

  it('Escape while drawing the energy arc puts the shape back and saves nothing', async () => {
    const calls = fakeBackend({ 'POST /steer': {} });
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    const graphic = screen.getByRole('img', { name: /Draw energy arc/ });
    const numeric = screen.getByRole('spinbutton', { name: 'Energy arc start numeric value' });
    vi.spyOn(graphic, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 40 } as DOMRect);
    Object.defineProperty(graphic, 'setPointerCapture', { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(graphic, { pointerId: 6, isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    expect(numeric).toHaveValue(100);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(numeric).toHaveValue(62);
    expect(graphic).not.toHaveAttribute('data-provisional');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('Escape during a finger drag of a song drops nothing, and lifting the finger later moves nothing', async () => {
    const calls = fakeBackend({ 'POST /mix/move': moved(0, 2) });
    render(<Timeline start={start} />);
    const grip = screen.getByRole('button', { name: 'Reorder Song 1' });
    const target = screen.getByRole('button', { name: 'Reorder Song 3' }).closest('li')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    fireEvent.pointerDown(grip, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(grip, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 80 });
    await waitFor(() => expect(target).toHaveClass('over'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(target).not.toHaveClass('over'));
    fireEvent.pointerUp(grip, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 80 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((call) => call.method === 'POST' && call.path.startsWith('/mix/move'))).toHaveLength(0);
    expect(titles()).toEqual(['Song 1', 'Song 2', 'Song 3']);
  });
});

// ---- touch boundaries --------------------------------------------------------------------------

type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const sheet = (name: string) => fs.readFileSync(`${node.cwd()}/src/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const touchAction = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((rule) => /touch-action:\s*([a-z-]+)/.exec(rule[1])?.[1])
    .filter(Boolean);
};

describe('SF-0243-05 touch scrolling boundaries', () => {
  it('only the reorder handle takes a finger away from scrolling the timeline', () => {
    const creation = sheet('styles/creation.css');
    expect(touchAction(creation, '.timeline .grip')).toContain('none');
    expect(touchAction(creation, '.timeline .song')).toEqual([]);
  });

  it('Studio squares leave vertical swipes to the page, and the grid scrolls sideways inside itself', () => {
    expect(touchAction(sheet('styles/creation.css'), '.studio-grid .studio-cell')).toEqual(['pan-y']);
    expect(sheet('styles/polish.css')).toMatch(/\.studio-grid\s*\{[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-inline:\s*contain/);
  });

  it('the energy arc leaves vertical swipes to the page in every sheet that styles it', () => {
    expect(touchAction(sheet('styles/music-objects.css'), '.energy-horizon.intention')).toEqual(['pan-y']);
    expect(touchAction(sheet('style.css'), '.energy-arc-preview')).toEqual(['pan-y']);
  });
});
