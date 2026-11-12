import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';
import type { Undo } from './shared';

/** GP-0258: exact-scope batch Library actions. Range selection, exact IDs, and an Undo only for
 * what the batch really changed. */

const row = (id: number, title: string, more: { priority?: boolean; never?: boolean } = {}) => ({
  id, artist: 'Someone', title, genre: null, duration: 200, bpm: null, camelot: null, lyric_status: null,
  never: more.never ?? false, priority: more.priority ?? false, detected_bpm: null, detected_camelot: null,
  override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});
const page = (...songs: ReturnType<typeof row>[]) => ({ songs, total: songs.length, next: null });

beforeEach(() => window.history.pushState({}, '', '/library'));

function show(notify: (message: string, undo?: Undo) => void = () => {}) {
  const player = new SetPlayer(() => [], () => {});
  render(<Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
    refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={notify} stage={false} toggleStage={() => {}} />);
}

const box = (title: string) => screen.getByRole('checkbox', { name: new RegExp(`Select recording ${title} by`) });

describe('GP-0258 exact-scope batch actions', () => {
  it('GP-0258-03 Shift selects the range of loaded recordings between two checkboxes, in the order shown', async () => {
    fakeBackend({ 'GET /library': page(...['A', 'B', 'C', 'D', 'E'].map((title, index) => row(index + 1, title))) });
    show();
    await screen.findByText('E');
    const user = userEvent.setup();
    await user.click(box('B'));
    await user.keyboard('{Shift>}');
    await user.click(box('D'));
    await user.keyboard('{/Shift}');
    expect(['A', 'B', 'C', 'D', 'E'].map((title) => (box(title) as HTMLInputElement).checked)).toEqual([false, true, true, true, false]);
    expect(screen.getByText(/3 of 5 loaded recordings selected/)).toBeInTheDocument();
    // a plain click still toggles just the one
    await user.click(box('C'));
    expect((box('C') as HTMLInputElement).checked).toBe(false);
    expect((box('B') as HTMLInputElement).checked).toBe(true);
  });

  it('GP-0258-02/04 sends exactly the selected IDs with the values that were shown', async () => {
    const calls = fakeBackend({
      'GET /library': page(row(1, 'A'), row(2, 'B', { priority: true }), row(3, 'C')),
      'POST /library/batch': { updated: 2, action: 'prioritize', ids: [1, 2] },
    });
    show();
    await screen.findByText('C');
    const user = userEvent.setup();
    await user.click(box('A'));
    await user.click(box('B'));
    await user.click(screen.getByRole('button', { name: 'Prioritize selected' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply batch Library action?' });
    expect(within(dialog).getByText(/ID 1; priority off/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ID 2; priority on/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/ID 3;/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm 2 recordings' }));
    await waitFor(() => expect(calls.filter((call) => call.path === '/library/batch')).toHaveLength(1));
    expect(calls.find((call) => call.path === '/library/batch')!.body).toEqual({
      action: 'prioritize', entries: [{ id: 1, expected: false }, { id: 2, expected: true }],
    });
  });

  it('GP-0258-07 Undo puts back only what the batch changed, and offers none when nothing changed', async () => {
    const calls = fakeBackend({
      'GET /library': page(row(1, 'A', { never: false }), row(2, 'B', { never: true })),
      'POST /library/batch': { updated: 2 },
    });
    const notify = vi.fn();
    show(notify);
    await screen.findByText('B');
    const user = userEvent.setup();
    await user.click(box('A'));
    await user.click(box('B'));
    await user.click(screen.getByRole('button', { name: /Never play selected|Exclude selected/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm 2 recordings' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    const [message, undo] = notify.mock.calls.at(-1)!;
    expect(message).toBe('Updated 2 precisely selected recordings.');
    expect(typeof undo).toBe('function');
    await (undo as () => Promise<void>)();
    const batches = calls.filter((call) => call.path === '/library/batch');
    expect(batches.at(-1)!.body).toEqual({ action: 'allow', entries: [{ id: 1, expected: true }] });

    // everything was already in the asked-for state: nothing to take back, so no Undo
    notify.mockClear();
    await user.click(box('B'));
    await user.click(screen.getByRole('button', { name: /Never play selected|Exclude selected/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm 1 recordings' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls.at(-1)![1]).toBeUndefined();
  });

  it('GP-0258-07 Undo pressed after a new search reloads the search on screen, not the one the batch was made in', async () => {
    fakeBackend({
      'GET /library': (_body: unknown, url: string) => (new URLSearchParams(url.split('?')[1]).get('q') === 'zed'
        ? page(row(9, 'Zed'))
        : page(row(1, 'A'), row(2, 'B'))),
      'POST /library/batch': { updated: 1 },
    });
    const notify = vi.fn();
    show(notify);
    await screen.findByText('B');
    const user = userEvent.setup();
    await user.click(box('A'));
    await user.click(screen.getByRole('button', { name: /Never play selected|Exclude selected/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm 1 recordings' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    const undo = notify.mock.calls.at(-1)![1] as () => Promise<void>;
    // a new search is on screen before Undo is pressed
    await user.type(screen.getByRole('searchbox', { name: 'Search your library' }), 'zed');
    await screen.findByText('Zed', {}, { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText('A')).toBeNull());
    await undo();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Zed')).toBeInTheDocument();
    expect(screen.queryByText('A')).toBeNull();
  });

  it('GP-0258-07 Undo of a priority batch puts back each song’s own earlier priority, as the server reported it', async () => {
    const calls = fakeBackend({
      'GET /library': page(row(1, 'A'), row(2, 'B')),
      'POST /library/batch': (body: unknown) => ((body as { action: string }).action === 'prioritize'
        ? { updated: 2, action: 'prioritize', ids: [1, 2], previous: [{ id: 1, priority: 50 }, { id: 2, priority: 0 }] }
        : { updated: 2 }),
    });
    const notify = vi.fn();
    show(notify);
    await screen.findByText('B');
    const user = userEvent.setup();
    await user.click(box('A'));
    await user.click(box('B'));
    await user.click(screen.getByRole('button', { name: 'Prioritize selected' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm 2 recordings' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    await (notify.mock.calls.at(-1)![1] as () => Promise<void>)();
    expect(calls.filter((call) => call.path === '/library/batch').at(-1)!.body).toEqual({
      action: 'restore_priority',
      entries: [{ id: 1, expected: true, priority: 50 }, { id: 2, expected: true, priority: 0 }],
    });
  });
});
