import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoaded } from '../state/async';
import { announce, LiveRegion, Problem } from './controls';
import { REVEAL_AFTER_MS, Skeleton } from './Skeleton';

// Vitest hands CSS ?raw imports back empty, so the sheets are read from disk (as spacing-tokens.test.ts does).
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const read = (path: string) => fs.readFileSync(`${node.cwd()}/src/${path}`, 'utf8');

/**
 * UI/UX polish ADR-0036.
 * P0038: the short-load reveal policy, measured on a fake clock: what a person would see for answers
 * that take 0 to 2000 ms. Ready content is never held back; a placeholder becomes visible only after
 * REVEAL_AFTER_MS, so a quick answer never flashes one. The same measurement in a real browser is
 * web/e2e/polish-p0038-reveal.e2e.ts.
 * P0042: immediate, delayed, partial, failed, retried, stale and out-of-order answers, recorded frame by
 * frame: no placeholder after content, no content from an older question, one placeholder per wait
 * (so "Loading" is said once) and no repeated announcement.
 */

type Frame = { at: number; shows: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** A panel built the way the app's pages are: placeholder only while nothing is known yet. */
function Panel({ load, which, frames }: { load: () => Promise<string[]>; which: string; frames: Frame[] }) {
  const loaded = useLoaded(load, which);
  const shows = loaded.data !== null
    ? `${loaded.stale ? 'stale ' : ''}content:${loaded.data.join(',')}`
    : loaded.state === 'failed' ? 'failed' : 'placeholder';
  useLayoutEffect(() => {
    const last = frames[frames.length - 1];
    if (!last || last.shows !== shows) frames.push({ at: Date.now(), shows });
  });
  if (loaded.data !== null) {
    return (
      <div>
        <ul>{loaded.data.map((song) => <li key={song}>{song}</li>)}</ul>
        {loaded.stale && <p className="warn">May be out of date. {loaded.message}</p>}
        <button type="button" onClick={() => void loaded.retry()}>Refresh</button>
      </div>
    );
  }
  if (loaded.state === 'failed') return <Problem retry={() => void loaded.retry()}>Couldn’t load your songs.</Problem>;
  return <Skeleton variant="library" lines={3} label="Loading your songs" />;
}

/** Collapses a recording to what was on screen, in order. */
const shown = (frames: Frame[]) => frames.map((frame) => frame.shows);
/** Content followed later by a placeholder is a flash. */
function flashes(frames: Frame[]) {
  const first = frames.findIndex((frame) => frame.shows.includes('content:'));
  return first < 0 ? 0 : frames.slice(first).filter((frame) => frame.shows === 'placeholder').length;
}

let skeletonMounts = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  skeletonMounts = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (added instanceof HTMLElement && (added.matches('.skeleton') || added.querySelector('.skeleton'))) skeletonMounts += 1;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
});
afterEach(() => vi.useRealTimers());

/** Renders the panel with an answer that takes `delay` ms and reports what a person saw. */
async function answerAfter(delay: number) {
  const frames: Frame[] = [];
  const answer = deferred<string[]>();
  const { container, unmount } = render(<Panel load={() => answer.promise} which="songs" frames={frames} />);
  let placeholderVisibleFrom: number | null = null;
  const watch = () => {
    if (placeholderVisibleFrom === null && container.querySelector('.skeleton[data-revealed="true"]')) placeholderVisibleFrom = Date.now();
  };
  for (let step = 0; step < delay; step += 5) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(5, delay - step)); });
    watch();
  }
  await act(async () => { answer.resolve(['One', 'Two']); await answer.promise; });
  const arrived = Date.now();
  const contentAt = frames.find((frame) => frame.shows.startsWith('content:'))!.at;
  unmount();
  return {
    frames,
    arrived,
    contentAt,
    visibleMs: placeholderVisibleFrom === null ? 0 : arrived - placeholderVisibleFrom,
  };
}

describe('P0038 short-load reveal policy', () => {
  it('chooses the reveal delay from the motion tokens and keeps it with reduced motion', () => {
    const tokens = read('styles/tokens.css');
    expect(Number(tokens.match(/--motion-fast: (\d+)ms;/)?.[1])).toBe(REVEAL_AFTER_MS);
    const polish = read('styles/polish.css');
    // geometry is reserved at once; only the bars wait
    expect(polish).toMatch(/\.skeleton\[data-revealed='false'\] \.skeleton-content \{ visibility: hidden; \}/);
    // the fade waits the same time; reduced motion drops the fade, and visibility (not an animation) keeps the wait
    expect(polish).toMatch(/\.skeleton-content \{[^}]*animation-delay: var\(--motion-fast\)/);
    expect(polish).not.toMatch(/data-revealed[^{]*\{[^}]*animation/);
  });

  it('measures what a person sees for answers taking 0 to 2000 ms', async () => {
    const table: Array<{ delay: number; visibleMs: number; heldBackMs: number; flashes: number }> = [];
    for (const delay of [0, 40, 80, 119, 120, 200, 500, 2000]) {
      const result = await answerAfter(delay);
      table.push({ delay, visibleMs: result.visibleMs, heldBackMs: result.contentAt - result.arrived, flashes: flashes(result.frames) });
    }
    for (const row of table) {
      // never an artificial minimum wait: content shows the moment its answer arrives
      expect(row.heldBackMs, `${row.delay} ms`).toBe(0);
      expect(row.flashes, `${row.delay} ms`).toBe(0);
      // a placeholder is seen only for the part of the wait after the reveal delay
      expect(row.visibleMs, `${row.delay} ms`).toBe(Math.max(0, row.delay - REVEAL_AFTER_MS));
    }
    // quick answers (up to the reveal delay) never show a placeholder at all
    expect(table.filter((row) => row.delay <= REVEAL_AFTER_MS).every((row) => row.visibleMs === 0)).toBe(true);
    expect(table.find((row) => row.delay === 2000)!.visibleMs).toBe(2000 - REVEAL_AFTER_MS);
  });
});

describe('P0042 response timing without flashes or repeated words', () => {
  it('immediate: an answer already there replaces the placeholder before it is ever revealed', async () => {
    const frames: Frame[] = [];
    const { container } = render(<Panel load={() => Promise.resolve(['One'])} which="songs" frames={frames} />);
    await act(async () => { await Promise.resolve(); });
    expect(shown(frames)).toEqual(['placeholder', 'content:One']);
    expect(frames[1].at).toBe(0);
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(skeletonMounts).toBe(1);
  });

  it('delayed: one placeholder for the whole wait, then content, with no placeholder after it', async () => {
    const result = await answerAfter(600);
    expect(shown(result.frames)).toEqual(['placeholder', 'content:One,Two']);
    expect(skeletonMounts).toBe(1);
  });

  it('partial then complete: the partial answer stays up through the refresh, no placeholder between', async () => {
    const frames: Frame[] = [];
    const answers = [deferred<string[]>(), deferred<string[]>()];
    let asked = 0;
    render(<Panel load={() => answers[asked++].promise} which="songs" frames={frames} />);
    await act(async () => { answers[0].resolve(['One']); });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading your songs' })).toBeNull();
    await act(async () => { answers[1].resolve(['One', 'Two', 'Three']); });
    expect(shown(frames)).toEqual(['placeholder', 'content:One', 'content:One,Two,Three']);
    expect(flashes(frames)).toBe(0);
    expect(skeletonMounts).toBe(1);
  });

  it('failed then retried: the error stays while retrying, then content, never back to a placeholder', async () => {
    const frames: Frame[] = [];
    const answers = [deferred<string[]>(), deferred<string[]>()];
    let asked = 0;
    render(<Panel load={() => answers[asked++].promise} which="songs" frames={frames} />);
    await act(async () => { answers[0].reject(new Error('connection lost')); });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByRole('status', { name: 'Loading your songs' })).toBeNull();
    await act(async () => { answers[1].resolve(['One']); });
    expect(shown(frames)).toEqual(['placeholder', 'failed', 'content:One']);
    expect(skeletonMounts).toBe(1);
  });

  it('stale: a failed refresh keeps the last good answer, marked, and a retry clears the mark', async () => {
    const frames: Frame[] = [];
    const answers = [deferred<string[]>(), deferred<string[]>(), deferred<string[]>()];
    let asked = 0;
    render(<Panel load={() => answers[asked++].promise} which="songs" frames={frames} />);
    await act(async () => { answers[0].resolve(['One']); });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await act(async () => { answers[1].reject(new Error('connection lost')); });
    expect(screen.getByText(/May be out of date/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await act(async () => { answers[2].resolve(['One', 'Two']); });
    expect(shown(frames)).toEqual(['placeholder', 'content:One', 'stale content:One', 'content:One,Two']);
    expect(flashes(frames)).toBe(0);
  });

  it('out of order: an older question answered late never shows under the newer one', async () => {
    const frames: Frame[] = [];
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const { rerender } = render(<Panel load={() => first.promise} which="rock" frames={frames} />);
    rerender(<Panel load={() => second.promise} which="jazz" frames={frames} />);
    await act(async () => { first.resolve(['Rock song']); });
    expect(screen.queryByText('Rock song')).toBeNull();
    await act(async () => { second.resolve(['Jazz song']); });
    expect(shown(frames)).toEqual(['placeholder', 'content:Jazz song']);
  });

  it('says the same announcement once, however many answers repeat it', async () => {
    render(<LiveRegion />);
    const region = document.querySelector('[aria-live="polite"][role="status"].visually-hidden') as HTMLElement;
    const said: string[] = [];
    const observer = new MutationObserver(() => { if (region.textContent) said.push(region.textContent); });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    act(() => { announce('Your songs are up to date'); announce('Your songs are up to date'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { announce('Your songs are up to date'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    observer.disconnect();
    expect(said).toEqual(['Your songs are up to date']);
  });
});
