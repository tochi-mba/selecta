import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import * as readiness from '../state/readiness';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

// Count row renders: every LibraryRow render reads its song's readiness exactly once.
vi.mock('../state/readiness', async (original) => {
  const real = await original<typeof import('../state/readiness')>();
  return { ...real, trackReadiness: vi.fn(real.trackReadiness) };
});

const row = (id: number) => ({
  id, artist: 'Someone', title: `Song ${id}`, genre: null, duration: 200, bpm: null, camelot: null,
  lyric_status: null, never: false, priority: false, detected_bpm: null, detected_camelot: null,
  override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});

beforeEach(() => window.history.pushState({}, '', '/library'));

describe('MI-0162-04: a poll re-renders only the Library rows whose facts changed', () => {
  it('leaves 60 rows alone when status and playback change, and redraws only the song that joined the line', async () => {
    const songs = Array.from({ length: 60 }, (_, index) => row(index + 1));
    fakeBackend({ 'GET /library': { songs, total: songs.length, next: null } });
    const player = new SetPlayer(() => [], () => {});
    const view = (state: ReturnType<typeof status>, now = player.state) => (
      <Library status={state} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={now} setView={() => {}} notify={() => {}}
        stage={false} toggleStage={() => {}} />
    );
    const { rerender } = render(view(status()));
    expect(await screen.findByRole('button', { name: 'Details for Song 60' })).toBeInTheDocument();
    const counted = vi.mocked(readiness.trackReadiness);
    counted.mockClear();

    // a status poll and a playback tick: new objects, nothing about any row
    rerender(view(status({ counts: { ...status().counts, analysed: 31 } }), { ...player.state, position: 3 }));
    expect(counted).not.toHaveBeenCalled();

    // song 7 joins the analysis line: only its row redraws, and it says so
    rerender(view(status({ analysing: [7] })));
    expect(counted).toHaveBeenCalledTimes(1);
    expect(counted.mock.calls[0][0]).toMatchObject({ id: 7 });
    expect(screen.getByRole('button', { name: 'Analysing…' })).toBeDisabled();
  });
});
