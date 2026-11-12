import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import type { WorkshopTab } from '../router';
import { fakeBackend, Reply, status } from '../test/backend';
import { Workshop } from './Workshop';

// P0106 (ADR-0043): the developer state showcase stays out of everyday Workspace navigation.
// It only appears in development (or gallery test) builds, and only under Diagnostics.
function show(tab: WorkshopTab) {
  const player = new SetPlayer(() => [], () => {});
  return render(
    <Workshop
      tab={tab}
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

const tabs: WorkshopTab[] = ['overview', 'analysis', 'storage', 'sources', 'learning', 'diagnostics'];

afterEach(() => vi.unstubAllEnvs());

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

describe('P0107 / P0111 storage controls reconcile to what the server confirmed', () => {
  it('names budget, cache, free disk and untouched music separately', async () => {
    fakeBackend({ 'GET /storage': storage });
    show('storage');
    expect(await screen.findByText('Made by SelectaDJ, can be made again')).toBeInTheDocument();
    expect(screen.getByText('1.0 GB of 3.0 GB allowed')).toBeInTheDocument();
    expect(screen.getByText('Everything else SelectaDJ keeps')).toBeInTheDocument();
    expect(screen.getByText('Free on this drive')).toBeInTheDocument();
    expect(screen.getByText(/Your music files aren’t counted here/)).toBeInTheDocument();
  });

  it('a refused save falls back to the last confirmed limit and says why', async () => {
    fakeBackend({ 'GET /storage': storage, 'POST /storage': new Reply(400, { detail: 'There isn’t that much room.' }) });
    show('storage');
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '9' } });
    expect(screen.getByText('9.0 GB')).toBeInTheDocument();
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent('There isn’t that much room. The limit is still 3.0 GB.');
    expect(screen.getByRole('button', { name: 'Retry saving budget' })).toBeInTheDocument();
  });

  it('a slow older save never replaces a newer choice', async () => {
    let release: (value: unknown) => void = () => {};
    const slow = new Promise((resolve) => { release = resolve; });
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return new Response(JSON.stringify(storage), { status: 200 });
      posts += 1;
      const body = JSON.parse(init?.body as string) as { budget_gb: number };
      if (posts === 1) await slow;
      return new Response(JSON.stringify({ ...storage, budget_bytes: body.budget_gb * GB }), { status: 200 });
    }));
    show('storage');
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    await waitFor(() => expect(posts).toBe(1), { timeout: 3000 });
    fireEvent.change(slider, { target: { value: '7' } });
    release(undefined);
    await waitFor(() => expect(posts).toBe(2), { timeout: 3000 });
    expect(await screen.findByText('Limit saved: 7.0 GB.', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('Limit saved: 5.0 GB.')).toBeNull();
  });
});

describe('P0106 the developer state showcase', () => {
  it('is absent from every Workspace tab in a production build', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SELECTA_GALLERY', '');
    for (const tab of tabs) {
      fakeBackend({});
      const { container, unmount } = show(tab);
      expect(container.querySelector('.control-gallery'), tab).toBeNull();
      unmount();
    }
  });

  it('is kept for development review under Diagnostics only, folded away', () => {
    vi.stubEnv('DEV', true);
    for (const tab of tabs) {
      fakeBackend({});
      const { container, unmount } = show(tab);
      const gallery = container.querySelector('details.control-gallery');
      if (tab === 'diagnostics') {
        expect(gallery).not.toBeNull();
        expect((gallery as HTMLDetailsElement).open).toBe(false);
      } else {
        expect(gallery, tab).toBeNull();
      }
      unmount();
    }
  });
});
