import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportJob, ExportJobState } from '../api';
import { fakeBackend } from '../test/backend';
import { ExportJobs, exportStage } from './ExportJobs';
import { resetExports } from './exportStore';

// S4-0108-04 and S4-0108-07: every export stage reads as itself with no invented percentage,
// and only a file that really exists offers a download.
const job = (id: string, state: ExportJobState, more: Partial<ExportJob> = {}): ExportJob => ({
  id, state, scope: 'current', draft: null, mix_name: `Mix ${id}`, revision: `rev-${id}`,
  songs: [{ song_id: 1, title: 'One', artist: 'A' }, { song_id: 2, title: 'Two', artist: 'B' }],
  seams: [{ key: `seam-${id}`, from: 'One', to: 'Two' }],
  seams_total: 1, seams_ready: 0, seconds_estimate: 400, name: `${id}.flac`, seconds: null,
  error: null, created_at: 1_700_000_000, can_cancel: false, quiet_seconds: 0, ...more,
});

const STATES: ExportJobState[] = ['preparing', 'encoding', 'ready', 'failed', 'cancelling', 'cancelled', 'interrupted', 'expired'];

describe('export job stages', () => {
  afterEach(() => resetExports());

  it('names every stage distinctly, and an unknown one as unknown rather than ready', () => {
    const words = STATES.map((state) => exportStage({ state }).words);
    expect(new Set(words).size).toBe(STATES.length);
    expect(exportStage({ state: 'from-a-newer-server' as ExportJobState })).toEqual({ kind: 'unavailable', words: 'State unknown' });
  });

  it('offers a download only for a ready file, never for expired, failed or unfinished jobs, and shows no percent', async () => {
    fakeBackend({
      'GET /exports/jobs': {
        jobs: STATES.map((state) => job(state, state, state === 'ready' ? { seconds: 400, seams_ready: 1 } : {})),
      },
    });
    render(<ExportJobs always />);
    const rows = await screen.findAllByRole('listitem').then((items) => items.filter((item) => item.classList.contains('export-job')));
    expect(rows).toHaveLength(STATES.length);
    for (const row of rows) {
      const state = row.getAttribute('data-state');
      const links = within(row).queryAllByRole('link', { name: /^download / });
      expect(links).toHaveLength(state === 'ready' ? 1 : 0);
      expect(row.textContent).not.toMatch(/\d+\s*%/);
    }
    const expired = rows.find((row) => row.getAttribute('data-state') === 'expired')!;
    expect(within(expired).getByText(/can’t be downloaded/)).toBeInTheDocument();
    expect(within(expired).getByText('Open this mix to export it again')).toBeInTheDocument();
  });

  it('one job in a state the site does not know reads "State unknown" on its own row, and the list stays', async () => {
    fakeBackend({
      'GET /exports/jobs': { jobs: [job('a', 'ready', { seconds: 400, seams_ready: 1 }), job('b', 'from-a-newer-server' as ExportJobState)] },
    });
    render(<ExportJobs always />);
    const rows = await screen.findAllByRole('listitem').then((items) => items.filter((item) => item.classList.contains('export-job')));
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('State unknown')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('State unknown')).toBeNull();
    expect(screen.queryByText(/Couldn’t check on your exports/)).toBeNull();
    expect(screen.queryByText(/Can’t check on these right now/)).toBeNull();
  });
});
