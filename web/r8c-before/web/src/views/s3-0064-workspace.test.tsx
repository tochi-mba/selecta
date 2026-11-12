import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import type { WorkshopTab } from '../router';
import { fakeBackend, status } from '../test/backend';
import { Workshop } from './Workshop';

/**
 * ADR-0064 (S3-0064-02/03/06): Analysis can be started and paused from Workspace, Sources says
 * plainly what leaves the PC, and Learning keeps the blind study's entry point while telling
 * automatic audio checks apart from a person's judgement.
 */

function show(more: Parameters<typeof status>[0] = {}, tab: WorkshopTab = 'overview') {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Workshop
      tab={tab}
      status={status(more)}
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

describe('S3-0064 Workspace sections', () => {
  it('Analysis starts the rest and pauses it again, saying it is safe to pause (S3-0064-02)', async () => {
    const calls = fakeBackend({ 'POST /analysis/start': {}, 'POST /analysis/stop': {} });
    show({ counts: { ...status().counts, music: 10, analysed: 4, ready: 4 }, analysis_running: false }, 'analysis');
    expect(screen.getByText(/6 songs left/)).toBeInTheDocument();
    expect(screen.getByText('Safe to pause any time.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Analyse the rest' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/analysis/start')).toBe(true));
  });

  it('a running analysis offers Pause and stops through its own route (S3-0064-02)', async () => {
    const calls = fakeBackend({ 'POST /analysis/stop': {} });
    show({ counts: { ...status().counts, music: 10, analysed: 4, ready: 4 }, analysis_running: true }, 'analysis');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/analysis/stop')).toBe(true));
    expect(calls.some((call) => call.path === '/analysis/start')).toBe(false);
  });

  it('Sources says the audio stays on the PC and exactly what the lyric lookup sends (S3-0064-03)', async () => {
    fakeBackend({ 'GET /folders': { folders: [{ path: 'C:\\Music', available: true, songs: 12 }], watch_every: 60 } });
    show({}, 'sources');
    expect(await screen.findByText('C:\\Music')).toBeInTheDocument();
    expect(screen.getByText(/Your audio stays on this PC/)).toBeInTheDocument();
    expect(screen.getByText(/artist, title, album and duration to LRCLIB/)).toBeInTheDocument();
  });

  it('Learning keeps the blind study entry point and separates automatic checks from a person’s ear (S3-0064-06)', async () => {
    fakeBackend({ 'GET /memory': { tried: 5, clean: 3, warned: 1, failed: 1, liked: 1, disliked: 0 } });
    show({}, 'learning');
    expect(await screen.findByRole('heading', { name: 'What it’s learned' })).toBeInTheDocument();
    expect(screen.getByText(/automatic checks on the audio\. They can’t say how something sounds/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blind listening study' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Study code/ })).toBeInTheDocument();
  });
});
