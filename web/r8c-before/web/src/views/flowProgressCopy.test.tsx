import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Workshop } from './Workshop';

// SF-0232-03: background work says what it really knows. A job with a count says "N to go" or
// "N in line"; nothing invents a percentage or a progress bar the server never reported.

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

const jobs = {
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 2, rendering: 1, failed: 0, none: 0, ready: 5 },
  drafts_in_line: 0,
  storage_full: false,
  analysis: { running: true, paused: false, asked_for: 0, left: 12 },
  failed_seams: [],
  failed_songs: [],
  estimates: 'Times are estimates.',
};

describe('progress copy', () => {
  it('counts what is left in real units and never shows a made-up percentage or bar', async () => {
    fakeBackend({ 'GET /jobs': jobs });
    show();
    expect(await screen.findByText('12 to go')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+\s*%/);
    expect(document.querySelector('progress, [role="progressbar"]')).toBeNull();
  });

  it('says it cannot tell rather than guessing when the server gives no job status', async () => {
    fakeBackend({});
    show();
    expect(await screen.findByText(/can’t report background jobs/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+\s*%/);
  });
});
