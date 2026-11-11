import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

/** GP-0251-07: search says how each result matched, says plainly when a match is only approximate,
 * and says so honestly when nothing matches. The words come from the server's match label. */

const row = (id: number, title: string, match: string | null) => ({
  id, artist: 'Crown Street', title, genre: null, duration: 200, bpm: null, camelot: null, lyric_status: null,
  never: false, priority: false, detected_bpm: null, detected_camelot: null, override_bpm: null, override_camelot: null,
  music_override: null, energy: null, grid_confidence: null, readiness: { status: 'ready', reason: '' }, match,
});

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={vi.fn()}
      stage={false} toggleStage={() => {}} />,
  );
}

afterEach(() => window.history.pushState({}, '', '/'));

describe('GP-0251-07 honest search explanations', () => {
  it('an exact match and an approximate one each say how they matched', async () => {
    window.history.pushState({}, '', '/library?q=Bohemian%20Rapsody');
    fakeBackend({ 'GET /library': { songs: [row(9, 'Bohemian Rhapsody', 'Approximate match - check the recording'), row(10, 'Bohemian Nights', 'Title and artist words')], total: 2, next: null } });
    show();
    expect(await screen.findByLabelText('Search match: Approximate match - check the recording')).toBeInTheDocument();
    expect(screen.getByLabelText('Search match: Title and artist words')).toBeInTheDocument();
    // the stored names are shown exactly, never the normalised search form
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
  });

  it('nothing matching says so and offers to clear the search, not to add music', async () => {
    window.history.pushState({}, '', '/library?q=qwxzv');
    fakeBackend({ 'GET /library': { songs: [], total: 0, next: null } });
    show();
    expect(await screen.findByRole('heading', { name: 'Nothing matches “qwxzv”.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add music' })).toBeNull();
  });
});
