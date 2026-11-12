import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { LocalBackup } from './LocalBackup';
import { Workshop } from './Workshop';

/** UF-0385-04/06: storage keeps disposable cache, protected priority stems and the original music apart,
 * and a local backup never claims to hold the music. */

const GB = 1024 ** 3;
afterEach(() => vi.unstubAllGlobals());

describe('UF-0385-04 storage budget', () => {
  it('names the cache, the protected priority stems and the untouched originals separately', async () => {
    fakeBackend({
      'GET /storage': {
        used_bytes: 4.2 * GB, kept_bytes: 3.2 * GB, cache_bytes: 4 * GB, free_bytes: 13 * GB, budget_bytes: 3 * GB,
        largest_budget_bytes: 13 * GB, smallest_budget_bytes: 0.5 * GB, total_bytes: 200 * GB,
      },
    });
    const player = new SetPlayer(() => [], () => {});
    render(
      <Workshop tab="storage" status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    expect(await screen.findByText(/Priority-song stem windows are protected/)).toBeInTheDocument();
    expect(screen.getByText(/Your music files aren’t counted here, because Selecta doesn’t copy them, and nothing here ever touches them\./)).toBeInTheDocument();
  });
});

describe('UF-0385-06 backup data scope', () => {
  it('says the backup holds app data only, never the original music', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ pending_restart: false, rollback_available: false }), { status: 200 })));
    render(<LocalBackup />);
    expect(screen.getByText(/Original music, audio caches and exports are not included/)).toBeInTheDocument();
    expect(screen.getByText(/cannot reconstruct music files that have moved or vanished/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/backs? up your music|includes your music/i);
  });
});
