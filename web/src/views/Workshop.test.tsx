import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import type { WorkshopTab } from '../router';
import { fakeBackend, status } from '../test/backend';
import { Workshop } from './Workshop';

const GB = 1024 ** 3;
const storage = {
  used_bytes: 4.2 * GB,
  kept_bytes: 3.2 * GB,
  cache_bytes: 1 * GB,
  free_bytes: 13 * GB,
  budget_bytes: 3 * GB,
  largest_budget_bytes: 13 * GB,
  smallest_budget_bytes: 0.5 * GB,
  total_bytes: 200 * GB,
};

function show(more: Parameters<typeof status>[0] = {}, tab: WorkshopTab = 'storage') {
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

describe('the storage slider', () => {
  it('moves the moment it’s dragged, before the server has answered', async () => {
    const calls = fakeBackend({ 'GET /storage': storage, 'POST /storage': { ...storage, budget_bytes: 5 * GB } });
    show();
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    expect(screen.getByText('5.0 GB')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ budget_gb: 5 }));
  });

  it('explains what’s used in plain words', async () => {
    fakeBackend({ 'GET /storage': storage });
    show();
    expect(await screen.findByText('Selecta is using 4.20 GB. Your drive has 13 GB free.')).toBeInTheDocument();
  });

  it('explains when protected priority stems exceed the selected limit', async () => {
    fakeBackend({
      'GET /storage': { ...storage, cache_bytes: 4 * GB, budget_bytes: 3 * GB },
    });
    show();
    expect(
      await screen.findByText(/Priority-song stem windows are protected, so they can temporarily put the cache over its limit/),
    ).toBeInTheDocument();
  });
});

describe('what happens in spare time', () => {
  it('says what Selecta does with nothing else to do, and how far it has got', async () => {
    fakeBackend({ 'GET /storage': storage });
    show({ transitions_ready: 124 }, 'analysis');
    expect(await screen.findByText(/tries out the best transitions across your library.*124 have come out clean so far/)).toBeInTheDocument();
  });
});

describe('the sections', () => {
  const jobs = {
    worker: { running: true, rendering_the_mix: true },
    mix: { queued: 1, rendering: 1, failed: 1, none: 2, ready: 3 },
    drafts_in_line: 2,
    storage_full: false,
    analysis: { running: false, paused: true, asked_for: 0, left: 7 },
    failed_seams: [{ from: 'One', to: 'Two', why: 'No room.' }],
    failed_songs: [{ id: 3, title: 'Broken', artist: 'A' }],
    estimates: 'Times are estimates.',
  };

  it('each link to their own address', async () => {
    fakeBackend({ 'GET /jobs': jobs });
    show({}, 'overview');
    expect(screen.getByRole('link', { name: 'Storage' })).toHaveAttribute('href', '/workshop/storage');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('say what’s really happening, including what’s failed', async () => {
    fakeBackend({ 'GET /jobs': jobs });
    show({}, 'overview');
    expect(await screen.findByText('Working through your current mix')).toBeInTheDocument();
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
    expect(screen.getByText('Paused, 7 to go')).toBeInTheDocument();
    expect(screen.getByText('One into Two')).toBeInTheDocument();
    expect(screen.getByText('Broken')).toBeInTheDocument();
    expect(screen.getByText('Times are estimates.')).toBeInTheDocument();
  });

  it('say when the storage limit has stopped things', async () => {
    fakeBackend({ 'GET /jobs': { ...jobs, storage_full: true } });
    show({}, 'overview');
    expect(await screen.findByText(/storage limit has been reached/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change the limit' })).toHaveAttribute('href', '/workshop/storage');
  });

  it('say when they can’t find out, rather than saying nothing’s happening', async () => {
    fakeBackend({});
    show({}, 'overview');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t find out what’s running');
  });

  it('show folders, and whether each can be found', async () => {
    const calls = fakeBackend({
      'GET /folders': { folders: [{ path: 'C:\\Music', available: true, songs: 12 }, { path: 'D:\\Gone', available: false, songs: 3 }], watch_every: 60 },
      'POST /folders/stop-watching': { folders: [], watch_every: 60 },
    });
    show({}, 'sources');
    expect(await screen.findByText('C:\\Music')).toBeInTheDocument();
    expect(screen.getByText(/Can’t find it right now/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop watching' })[0]);
    await waitFor(() => expect(calls.find((call) => call.path === '/folders/stop-watching')?.body).toEqual({ folder: 'C:\\Music' }));
  });

  it('show diagnostics with nothing personal in them, ready to copy', async () => {
    fakeBackend({ 'GET /diagnostics': { api_version: 2, platform: 'win32' } });
    show({}, 'diagnostics');
    expect(await screen.findByText(/"api_version": 2/)).toBeInTheDocument();
    expect(screen.getByText(/No paths or song names/)).toBeInTheDocument();
  });

  it('show the slider what was really saved', async () => {
    fakeBackend({ 'GET /storage': storage, 'POST /storage': { ...storage, budget_bytes: 4 * GB } });
    show();
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '9' } });
    expect(screen.getByText('9.0 GB')).toBeInTheDocument();
    expect(await screen.findByText('4.0 GB', {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
