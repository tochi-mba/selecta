import { appendFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, ProfilerOnRenderCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixItem, Status } from '../api';
import { NowState, SetPlayer } from '../player';
import { fakeBackend, seam, songs, status as appStatus } from '../test/backend';
import { Links } from './Links';
import { Mix } from './Mix';
import { Workshop } from './Workshop';

// Client-side speed (r8c): a page must not redraw itself because the music clock moved, and a poll
// that brings back nothing new must not redraw a long list. These count React commits with the
// Profiler and print the time they took, so a slower build shows up as a number, not a feeling.

type Tally = { commits: number; ms: number };
const tally = (): [Tally, ProfilerOnRenderCallback] => {
  const seen = { commits: 0, ms: 0 };
  return [seen, (_id, _phase, actual) => { seen.commits += 1; seen.ms += actual; }];
};
const report = (what: string, seen: Tally) => {
  const line = `[r8c] ${what}: ${seen.commits} commits, ${seen.ms.toFixed(1)} ms`;
  console.info(line);
  // R8C_METRICS names a file to collect the numbers in, since a passing test's console may be hidden
  if (process.env.R8C_METRICS) appendFileSync(process.env.R8C_METRICS, line + '\n');
};

const longMix = (count: number): MixItem[] => songs(...Array.from({ length: count - 1 }, (_, index) => seam('ready', `s${index}`)));

const player = new SetPlayer(() => [], () => {});
const stable = {
  refreshMix: () => {}, setMixData: () => {}, refreshStatus: () => {}, setView: () => {}, notify: () => {}, toggleStage: () => {},
};

let setClock: (next: NowState) => void = () => {};
function Clocked({ children }: { children: (now: NowState) => React.ReactNode }) {
  const [now, setNow] = useState<NowState>({ ...player.state, phase: 'playing', position: 3 });
  setClock = setNow;
  return <>{children(now)}</>;
}

afterEach(() => { vi.useRealTimers(); });

describe('r8c the editor with a long mix', () => {
  it('does not redraw 120 songs when only the music clock moves', () => {
    const mix = longMix(120);
    const state: Status = appStatus();
    const [seen, onRender] = tally();
    render(
      <Clocked>
        {(now) => (
          <Profiler id="mix" onRender={onRender}>
            <Mix status={state} mix={mix} mixName="Long" canUndo={false} player={player} now={now} stage={false} {...stable} />
          </Profiler>
        )}
      </Clocked>,
    );
    expect(document.querySelectorAll('li.song')).toHaveLength(120);
    const mounted = { ...seen };
    report('editor mount, 120 songs', mounted);
    seen.commits = 0;
    seen.ms = 0;
    for (let second = 1; second <= 10; second += 1) {
      act(() => setClock({ ...player.state, phase: 'playing', position: 3, songTime: second }));
    }
    report('editor, 10 clock ticks', seen);
    expect(seen.commits).toBe(0);

    seen.commits = 0;
    seen.ms = 0;
    act(() => setClock({ ...player.state, phase: 'playing', position: 4, songTime: 0 }));
    report('editor, next song', seen);
    expect(seen.commits).toBe(1);
    expect(document.querySelector('li.song.playing')?.getAttribute('data-position')).toBe('4');
  });
});

describe('r8c pages that never show the clock', () => {
  it('Workshop is not redrawn by the music clock', async () => {
    fakeBackend({});
    const state = appStatus();
    const [seen, onRender] = tally();
    render(
      <Clocked>
        {(now) => (
          <Profiler id="workshop" onRender={onRender}>
            <Workshop status={state} mix={[]} mixName="" canUndo={false} player={player} now={now} stage={false} tab="overview" {...stable} />
          </Profiler>
        )}
      </Clocked>,
    );
    await act(async () => { await Promise.resolve(); });
    seen.commits = 0;
    seen.ms = 0;
    for (let second = 1; second <= 10; second += 1) {
      act(() => setClock({ ...player.state, phase: 'playing', songTime: second }));
    }
    report('workshop, 10 clock ticks', seen);
    expect(seen.commits).toBe(0);
  });
});

describe('r8c Discover word links', () => {
  const link = (index: number) => ({
    phrase: `word${index}`, kind: 'x', a: index * 2 + 1, b: index * 2 + 2, artist_a: 'A', title_a: `One ${index}`, artist_b: 'B',
    title_b: `Two ${index}`, line_a: `all word${index}`, line_b: `word${index} we go`, moves: ['word_cut'], move: 'word_cut',
    state: { status: 'none', key: `k${index}` }, worked: index % 3 !== 0,
  });
  const sixty = { links: Array.from({ length: 60 }, (_, index) => link(index)), prepared: 0, preparing: 0 };

  it('a poll that brings back the same 60 links redraws nothing, nor does the clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = fakeBackend({ 'GET /links': sixty, 'GET /drafts': { drafts: [] } });
    const [seen, onRender] = tally();
    render(
      <Clocked>
        {(now) => (
          <Profiler id="links" onRender={onRender}>
            <Links status={appStatus()} mix={[]} mixName="" canUndo={false} player={player} now={now} stage={false} tab="words" {...stable} />
          </Profiler>
        )}
      </Clocked>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(await screen.findAllByRole('article')).toHaveLength(60);
    seen.commits = 0;
    seen.ms = 0;
    const before = calls.filter((call) => call.path.startsWith('/links')).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
    expect(calls.filter((call) => call.path.startsWith('/links')).length).toBeGreaterThan(before);
    report('discover, identical poll of 60 links', seen);
    expect(seen.commits).toBe(0);

    for (let second = 1; second <= 5; second += 1) {
      act(() => setClock({ ...player.state, phase: 'playing', songTime: second }));
    }
    report('discover, 5 clock ticks', seen);
    expect(seen.commits).toBe(0);
  });

  it('typing in the search redraws no card', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeBackend({ 'GET /links': sixty, 'GET /drafts': { drafts: [] } });
    const [seen, onRender] = tally();
    render(
      <Profiler id="links" onRender={onRender}>
        <Links status={appStatus()} mix={[]} mixName="" canUndo={false} player={player} now={player.state} stage={false} tab="words" {...stable} />
      </Profiler>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(await screen.findAllByRole('article')).toHaveLength(60);
    seen.commits = 0;
    seen.ms = 0;
    const search = screen.getByRole('searchbox', { name: 'Search shared words' });
    for (const text of ['w', 'wo', 'wor', 'word', 'word1']) fireEvent.change(search, { target: { value: text } });
    report('discover, 5 keystrokes over 60 cards', seen);
    expect(seen.commits).toBe(5);
  });
});
