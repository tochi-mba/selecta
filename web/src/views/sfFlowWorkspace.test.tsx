import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import type { WorkshopTab } from '../router';
import { fakeBackend, Reply, status } from '../test/backend';
import { Workshop } from './Workshop';

const GB = 1024 ** 3;

function show(tab: WorkshopTab, more: Parameters<typeof status>[0] = {}) {
  const player = new SetPlayer(() => [], () => {});
  return render(
    <Workshop tab={tab} status={status(more)} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

const faults = {
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 0, rendering: 0, failed: 1, none: 0, ready: 2 },
  drafts_in_line: 0,
  storage_full: true,
  analysis: { running: false, paused: true, asked_for: 0, left: 12 },
  failed_seams: [{ from: 'Song 1', to: 'Song 2', why: 'No safe vocal runway.' }],
  failed_songs: [{ id: 4, title: 'Broken', artist: 'Someone' }],
  estimates: '',
};

// SF-0230-02: what someone can fix sits above the passive counts, each with the action that fixes it.
describe('SF-0230-02 health summary order', () => {
  it('puts every known fault, with its fix, above the metrics and the job list', async () => {
    fakeBackend({
      'GET /jobs': faults,
      'GET /folders': { folders: [{ path: 'D:/Music', available: false, songs: 40 }], watch_every: 0 },
    });
    show('overview', { counts: { total: 100, music: 90, set_aside: 10, analysed: 50, ready: 3, lyrics: 40 } });
    const needs = (await screen.findByText(/music folder can’t be found/)).closest('section')!;
    const items = within(needs).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('a, button')?.textContent)).toEqual([
      'Make more room', 'See what’s holding them back', 'Choose another move', 'Look at those songs', 'Carry on', 'See your folders',
    ]);
    const metrics = document.querySelector('.metrics')!;
    const jobs = screen.getByRole('heading', { name: 'What’s happening now' });
    expect(needs.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(metrics.compareDocumentPosition(jobs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

const storage = (cache: number, budget = 3) => ({
  used_bytes: 6 * GB, kept_bytes: 2 * GB, cache_bytes: cache * GB, free_bytes: 13 * GB, budget_bytes: budget * GB,
  largest_budget_bytes: 13 * GB, smallest_budget_bytes: 0.5 * GB, total_bytes: 200 * GB,
});

// SF-0230-05: lowering the limit below what's kept previews the removal, waits for a yes, and reports
// what actually went, or that nothing did.
describe('SF-0230-05 storage maintenance', () => {
  it('previews, and Keep cancels without sending anything', async () => {
    const calls = fakeBackend({ 'GET /storage': storage(2.5) });
    show('storage');
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '1' } });
    const preview = screen.getByRole('group', { name: 'Before anything is removed' });
    expect(preview).toHaveTextContent('A limit of 1.0 GB removes up to 1.5 GB of vocals and seams, oldest first.');
    fireEvent.click(within(preview).getByRole('button', { name: 'Keep 3.0 GB' }));
    expect(screen.queryByRole('group', { name: 'Before anything is removed' })).toBeNull();
    await new Promise((done) => setTimeout(done, 500));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(screen.getByRole('slider')).toHaveValue('3');
  });

  it('removes only after a yes, and reports the real amount from the server', async () => {
    const calls = fakeBackend({ 'GET /storage': storage(2.5), 'POST /storage': storage(1.2, 1) });
    show('storage');
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '1' } });
    await new Promise((done) => setTimeout(done, 500));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove up to 1.5 GB' }));
    // the server kept priority stems, so less went than the preview's upper bound, and it says so
    expect(await screen.findByText('Removed 1.3 GB. SelectaDJ now keeps 1.2 GB it can make again.')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST').map((call) => (call.body as { budget_gb: number }).budget_gb)).toEqual([1]);
  });

  it('a failed removal says nothing was removed, and the limit goes back', async () => {
    fakeBackend({ 'GET /storage': storage(2.5), 'POST /storage': new Reply(500, { detail: 'The disk said no.' }) });
    show('storage');
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove up to 1.5 GB' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was removed. The disk said no. The limit is still 3.0 GB.');
    await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('3'));
  });

  it('raising the limit removes nothing, so it saves without asking', async () => {
    const calls = fakeBackend({ 'GET /storage': storage(2.5), 'POST /storage': storage(2.5, 5) });
    show('storage');
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '5' } });
    expect(screen.queryByRole('group', { name: 'Before anything is removed' })).toBeNull();
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ budget_gb: 5 }));
  });
});
