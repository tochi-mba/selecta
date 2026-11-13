import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler, ProfilerOnRenderCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { NowState, SetPlayer } from '../player';
import { keepUnchangedDrafts } from '../state/keepUnchanged';
import { fakeBackend } from '../test/backend';
import { MyMixes } from './MyMixes';

// r8a: My Mixes with hundreds of drafts. A draft's row is drawn once when it appears, and again only
// when that draft changes: not when the music clock moves, not when a poll brings back what's already
// shown, and not when another draft changes. Rows are counted by how often each one works out its
// readiness, which every row does exactly once per draw.

const drawn = vi.hoisted(() => ({ rows: 0 }));
vi.mock('../state/readiness', async (importOriginal) => {
  const real = await importOriginal<typeof import('../state/readiness')>();
  return {
    ...real,
    draftReadiness: (draft: Parameters<typeof real.draftReadiness>[0]) => {
      drawn.rows += 1;
      return real.draftReadiness(draft);
    },
  };
});

const DRAFTS = 500;
const SHOWN = 40; // the first page; the rest come with "Show 40 more"
const draft = (id: number, more: Partial<DraftInfo> = {}): DraftInfo => ({
  id, name: `Draft ${id}`, songs: 20, seconds: 4000, seams: 19, ready: 6, failed: 0, waiting: 13,
  rendering: false, place: null, eta: null, to_render: 600, missing: 0,
  song_ids: Array.from({ length: 20 }, (_, index) => id * 100 + index), ...more,
});
const list = (changed: Record<number, Partial<DraftInfo>> = {}): DraftList => ({
  drafts: Array.from({ length: DRAFTS }, (_, index) => draft(DRAFTS - index, changed[DRAFTS - index])),
  current: { name: 'Current', songs: 0, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
  out_of_room: false,
});

type Tally = { commits: number; ms: number };
const tally = (): [Tally, ProfilerOnRenderCallback] => {
  const seen = { commits: 0, ms: 0 };
  return [seen, (_id, _phase, actual) => { seen.commits += 1; seen.ms += actual; }];
};
const report = (what: string, rows: number, seen: Tally) => {
  console.info(`[r8a] ${what}: ${rows} rows drawn, ${seen.commits} commits, ${seen.ms.toFixed(1)} ms`);
};

const player = new SetPlayer(() => [], () => {});
let setClock: (next: NowState) => void = () => {};
function Clocked({ children }: { children: (now: NowState) => React.ReactNode }) {
  const [now, setNow] = useState<NowState>({ ...player.state, phase: 'playing', position: 0 });
  setClock = setNow;
  return <>{children(now)}</>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('r8a My Mixes with 500 drafts', () => {
  it('draws each row once, and after that only the rows whose draft changed', async () => {
    let answer = list();
    fakeBackend({ 'GET /drafts': () => answer, 'POST /drafts/496/name': { name: 'Draft 496' } });
    const [seen, onRender] = tally();
    // a parent that hands new functions every time, as a careless caller would
    render(
      <Clocked>
        {(now) => (
          <Profiler id="mine" onRender={onRender}>
            <MyMixes mix={[]} mixName="Current" now={now} player={player} canUndo={false}
              refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}} status={undefined as never}
              stage={false} toggleStage={() => {}} setView={() => {}} notify={() => {}}
              openDraft={() => {}} playDraft={async () => {}} />
          </Profiler>
        )}
      </Clocked>,
    );
    await screen.findByRole('button', { name: 'More actions for Draft 500' });
    expect(document.querySelectorAll('li.draft')).toHaveLength(SHOWN);
    report('mount, 500 drafts', drawn.rows, seen);
    expect(drawn.rows).toBe(SHOWN);

    // the music clock moves ten times: the page says Playing, the list stays as it is
    drawn.rows = 0; seen.commits = 0; seen.ms = 0;
    for (let second = 1; second <= 10; second += 1) {
      act(() => setClock({ ...player.state, phase: 'playing', position: 0, songTime: second }));
    }
    report('10 clock ticks', drawn.rows, seen);
    expect(drawn.rows).toBe(0);

    // renaming one draft and leaving it alone redraws that row (into the form and back), and the
    // list read afterwards, which says the same, redraws nothing
    drawn.rows = 0; seen.commits = 0; seen.ms = 0;
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Draft 496' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Draft 496' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'More actions for Draft 496' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    report('rename and cancel, then the same list again', drawn.rows, seen);
    expect(drawn.rows).toBeLessThanOrEqual(3);

    // one draft finishes a transition: the next read redraws that row alone
    answer = list({ 498: { ready: 7, waiting: 12 } });
    drawn.rows = 0; seen.commits = 0; seen.ms = 0;
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Draft 495' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Draft 495' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('img', { name: /7 of 19 transitions ready/ })).toBeInTheDocument());
    report('one draft changed', drawn.rows, seen);
    // Draft 495 into its form and back, and Draft 498 with its new count
    expect(drawn.rows).toBeLessThanOrEqual(4);
  });
});

describe('r8a keepUnchangedDrafts', () => {
  it('keeps the very same list when nothing changed, and every unchanged draft when one did', () => {
    const before = list();
    expect(keepUnchangedDrafts(before, list())).toBe(before);
    const after = keepUnchangedDrafts(before, list({ 7: { ready: 9 } }));
    expect(after).not.toBe(before);
    const kept = after.drafts.filter((item, index) => item === before.drafts[index]);
    expect(kept).toHaveLength(DRAFTS - 1);
    expect(after.drafts.find((item) => item.id === 7)?.ready).toBe(9);
    // a draft gone or the current mix changed is a new list too
    const fewer = { ...list(), drafts: list().drafts.slice(1) };
    expect(keepUnchangedDrafts(before, fewer).drafts).toHaveLength(DRAFTS - 1);
    const playing = { ...list(), current: { ...list().current, songs: 3 } };
    expect(keepUnchangedDrafts(before, playing).current.songs).toBe(3);
  });
});
