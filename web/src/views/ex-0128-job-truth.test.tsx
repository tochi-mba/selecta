import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { refreshJobs } from '../state/jobs';
import { fakeBackend, Reply, status } from '../test/backend';
import { Workshop } from './Workshop';

/**
 * EX-0128-03: blocked, paused, queued and failed background work read as four different things, and
 * a stale or faulty jobs answer is never shown as live, nor as "nothing is happening".
 */
function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Workshop
      tab="overview"
      status={status({})}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={() => {}}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

const base = {
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 3, rendering: 0, failed: 0, none: 0, ready: 0 },
  drafts_in_line: 0,
  storage_full: false,
  analysis: { running: false, paused: true, asked_for: 0, left: 7 },
  failed_seams: [],
  failed_songs: [{ id: 3, title: 'Broken', artist: 'A' }],
  estimates: 'Times are estimates.',
};

const words = (selector: string) => [...document.querySelectorAll(`.job-list ${selector}, .job-failures ${selector}`)].map((node) => node.textContent);

describe('EX-0128-03 job state labels', () => {
  it('queued, paused and failed each have their own words and status kind', async () => {
    fakeBackend({ 'GET /jobs': base });
    show();
    expect(await screen.findByText('3 transitions in line')).toHaveClass('status-queued');
    expect(screen.getByText('Paused, 7 to go')).toHaveClass('status-paused');
    expect(screen.getByText('Broken').closest('.status')).toHaveClass('status-failed');
    expect(words('.status-paused').join(' ')).not.toMatch(/fail|line/i);
  });

  it('a storage block says Blocked, never Paused, and links to the fix', async () => {
    fakeBackend({ 'GET /jobs': { ...base, storage_full: true, analysis: { ...base.analysis, paused: false, left: 0 } } });
    show();
    const blocked = await screen.findByText('Blocked: the storage limit has been reached');
    expect(blocked).not.toHaveClass('status-paused');
    expect(blocked).not.toHaveClass('status-queued');
    expect(blocked.textContent).not.toMatch(/paused/i);
    expect(screen.getAllByRole('link', { name: /Change the limit|Make more room/ })[0]).toHaveAttribute('href', '/workshop/storage');
  });

  it('a malformed or failed refresh keeps the last answer but says it may be out of date', async () => {
    fakeBackend({ 'GET /jobs': base });
    show();
    await screen.findByText('3 transitions in line');
    fakeBackend({ 'GET /jobs': { worker: { running: true } } });
    await refreshJobs();
    expect(await screen.findByText(/may be out of date/)).toBeInTheDocument();
    fakeBackend({ 'GET /jobs': new Reply(503, { detail: 'busy' }) });
    await refreshJobs();
    await waitFor(() => expect(screen.getByText(/may be out of date/)).toBeInTheDocument());
    expect(screen.getByText('3 transitions in line')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you right now/)).not.toBeInTheDocument();
  });
});
