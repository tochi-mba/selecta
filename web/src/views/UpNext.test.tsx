import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportJob, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { ExportJobs, exportStage } from './ExportJobs';
import { ExportPanel } from './ExportPanel';
import { resetExports } from './exportStore';
import { MixScope } from './mixScope';
import { Now } from './Now';

// Flow ADR-0215 (Up Next) and ADR-0231 (Export Studio) acceptance checks.

function listen(tracks: MixItem[], position = 0) {
  fakeBackend({ [`GET /songs/${tracks[position].song_id}`]: { ...tracks[position], peaks: [], lines: [], sections: [] } });
  const player = new SetPlayer(() => tracks, () => {});
  return render(
    <Now
      status={status()}
      mix={tracks}
      mixName="Test mix"
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, phase: 'playing', position, songTime: 2, duration: 200, nextReady: false }}
      setView={() => {}}
      notify={() => {}}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

const upNext = () => screen.getByText('Up Next').closest('section') as HTMLElement;

describe('SF-0215 Up Next', () => {
  it('SF-0215-02 keeps planned, ready and failed transitions visibly distinct', () => {
    const planned = listen(songs(seam('none', 'a')));
    expect(within(upNext()).getByText('Not rendered yet')).toBeInTheDocument();
    expect(upNext()).toHaveTextContent('Planned: Blend. It hasn’t been made yet');
    planned.unmount();

    const ready = listen(songs(seam('ready', 'a', { label: 'Blend' })));
    expect(within(upNext()).getByText('Blend, ready')).toBeInTheDocument();
    expect(upNext()).not.toHaveTextContent('Planned:');
    ready.unmount();

    listen(songs(seam('failed', 'a')));
    expect(within(upNext()).getByText('Blend won’t work here')).toBeInTheDocument();
    expect(upNext()).toHaveTextContent('falls back to its own pick');
    expect(upNext()).not.toHaveTextContent('Planned:');
  });

  it('SF-0215-01 names the next song and artist first, inside the Up Next section', () => {
    listen(songs(seam('ready', 'a', { label: 'Blend' })));
    const section = upNext();
    expect(within(section).getByText('Song 2').tagName).toBe('B');
    expect(section).toHaveTextContent('Artist 2');
  });

  it('SF-0215-03 says steering changes only the next song, and guards it with the mix it saw', async () => {
    const tracks = songs(seam('ready', 'a'), seam('ready', 'b'));
    const calls = fakeBackend({
      'GET /songs/1': { ...tracks[0], peaks: [], lines: [], sections: [] },
      'POST /mix/1/swap': { mix: tracks, name: 'Test mix', can_undo: true },
    });
    const fetchSpy = vi.mocked(fetch);
    const player = new SetPlayer(() => tracks, () => {});
    render(
      <Now status={status()} mix={tracks} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 200 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    expect(screen.getByRole('heading', { name: 'Change the next song' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Change what plays next' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Calmer' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.startsWith('/mix/1/swap'))).toBe(true));
    const swap = fetchSpy.mock.calls.find(([url]) => String(url).includes('/mix/1/swap'))!;
    expect(new Headers((swap[1] as RequestInit).headers).get('x-mix-order')).toBe('1,2,3');
  });

  it('SF-0215-05 ends the set with no phantom next track', () => {
    const tracks = songs(seam('ready', 'a'));
    listen(tracks, 1);
    expect(screen.queryByText('Up Next')).toBeNull();
    expect(screen.getByText('This is the last song in the mix.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next song' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Change the next song' })).toBeNull();
  });
});

const job = (more: Partial<ExportJob> = {}): ExportJob => ({
  id: 'job-1', state: 'preparing', scope: 'current', draft: null, mix_name: 'Test mix', revision: 'a1b2c3d4e5f6',
  songs: [{ song_id: 1, title: 'Song 1', artist: 'Artist 1' }, { song_id: 2, title: 'Song 2', artist: 'Artist 2' }],
  seams: [{ key: 'a', from: 'Song 1', to: 'Song 2' }], seams_total: 1, seams_ready: 0, seconds_estimate: 400,
  name: 'mix.flac', seconds: null, error: null, created_at: 1700000000, can_cancel: true, quiet_seconds: 0, ...more,
});

describe('SF-0231 Export Studio', () => {
  beforeEach(() => resetExports());

  it('SF-0231-02 gives each job phase its own words and status kind', () => {
    const phases = (['preparing', 'encoding', 'ready', 'failed', 'cancelled', 'interrupted', 'expired'] as const)
      .map((state) => exportStage({ state }));
    expect(new Set(phases.map((phase) => phase.words)).size).toBe(phases.length);
    expect(exportStage({ state: 'ready' }).kind).toBe('ready');
    expect(exportStage({ state: 'failed' }).kind).toBe('failed');
    expect(exportStage({ state: 'encoding' }).words).toBe('Creating the FLAC file');
  });

  it('SF-0231-03 counts real transitions and never shows an invented percentage', async () => {
    fakeBackend({ 'GET /exports/jobs': { jobs: [job({ seams_total: 3, seams_ready: 1, seams: [] })] } });
    render(<ExportJobs always />);
    const row = await screen.findByText(/Preparing transitions, 1 of 3 ready/);
    expect(row).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+\s*%/);
    expect(document.querySelector('progress, [role="progressbar"]')).toBeNull();
  });

  it('SF-0231-05 offers Cancel only when the server says it can still cancel, and retry from the mix after', async () => {
    fakeBackend({ 'GET /exports/jobs': { jobs: [
      job({ id: 'a', mix_name: 'Waiting mix' }),
      job({ id: 'b', mix_name: 'Writing mix', state: 'encoding', can_cancel: false }),
      job({ id: 'c', mix_name: 'Failed mix', state: 'failed', can_cancel: false, error: 'There isn’t enough free space.' }),
    ] } });
    render(<ExportJobs always />);
    expect(await screen.findByRole('button', { name: 'Cancel the export of Waiting mix' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel the export of Writing mix' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel the export of Failed mix' })).toBeNull();
    expect(screen.getByText('There isn’t enough free space.')).toBeInTheDocument();
  });

  it('SF-0231-01 confirms the frozen mix, its revision and exact songs once saving starts', async () => {
    fakeBackend({ 'GET /exports/jobs': { jobs: [] }, 'POST /exports/jobs': job() });
    render(
      <MixScope.Provider value={null}>
        <ExportPanel mix={songs(seam('ready', 'a'))} mixName="Test mix" inDraft={false} guard={{}} setMixData={() => {}} names={{}} onClose={() => {}} />
      </MixScope.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    expect(await screen.findByText(/Frozen revision/)).toHaveTextContent('a1b2c3d4e5f6');
    const snapshot = screen.getByText(/Review frozen order/).closest('details') as HTMLElement;
    expect(snapshot).toHaveTextContent('cannot be changed by editing the mix now');
    expect(within(snapshot).getByText('Song 1')).toBeInTheDocument();
    expect(snapshot).toHaveTextContent('Song 1 into Song 2: a');
  });
});
