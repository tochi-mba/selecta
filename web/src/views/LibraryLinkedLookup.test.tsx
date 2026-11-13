import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

/** LX-0349-05: an open sheet whose song left the list reads that song once, not on every refresh. */

const row = (id: number, title: string) => ({
  id, artist: 'Someone', title, genre: null, duration: 200, bpm: null, camelot: null, lyric_status: null,
  never: false, priority: false, detected_bpm: null, detected_camelot: null,
  override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});

beforeEach(() => window.history.pushState({}, '', '/library'));

describe('LX-0349-05 the open song read by its ID', () => {
  it('asks once when the answer does not hold that song, however often the list changes', async () => {
    const calls = fakeBackend({
      'GET /library': (_body: unknown, url: string) => {
        const params = new URLSearchParams(url.split('?')[1]);
        if (params.get('limit') === '1') return { songs: [], total: 0, next: null };
        const q = params.get('q') ?? '';
        return q ? { songs: [row(5, `Other ${q}`)], total: 1, next: null } : { songs: [row(1, 'Alpha')], total: 1, next: null };
      },
    });
    const player = new SetPlayer(() => [], () => {});
    render(<Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Details for Alpha' }));
    const search = screen.getByRole('searchbox', { name: 'Search your library' });
    await userEvent.type(search, 'x');
    await screen.findByText('Other x', {}, { timeout: 3000 });
    await userEvent.type(search, 'y');
    await screen.findByText('Other xy', {}, { timeout: 3000 });
    await userEvent.type(search, 'z');
    await screen.findByText('Other xyz', {}, { timeout: 3000 });
    await new Promise((done) => setTimeout(done, 50));
    const lookups = () => calls.filter((call) => /[?&]limit=1(&|$)/.test(call.path)).length;
    await waitFor(() => expect(lookups()).toBeGreaterThan(0));
    expect(lookups()).toBe(1);
  });
});
