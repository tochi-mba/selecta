import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures, setFlags } from '../flags';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';
import { CLOUD_ONLY_FOOTER } from './musicHomes';

// cloud.one_shell (two-places plan phase 8): CloudApp mounts CloudShell for every Cloud account,
// and an account with no music on its devices gets it cloud only. With the flag off, the routing
// is exactly as before (CloudShell.test.tsx and CloudApp.test.tsx hold that).

// The shell is a lazy chunk: its first load in a busy run takes longer than the default second.
configure({ asyncUtilTimeout: 10_000 });

// One AuthKit answer for every render: a new token getter each time would make a new request
// client each render, so the speaker's session poll would start again before it ever ran.
const auth = vi.hoisted(() => {
  const answer = { isLoading: false, user: { id: 'user-1', email: 'listener@example.test', emailVerified: true } as unknown, getAccessToken: async () => 'token', signIn: async () => undefined, signUp: async () => undefined, signOut: async () => undefined };
  return { answer, LoginRequiredError: class LoginRequiredError extends Error {} };
});
vi.mock('@workos-inc/authkit-react', () => ({
  LoginRequiredError: auth.LoginRequiredError,
  useAuth: () => auth.answer,
}));
// getting started is finished, so the spine never stands in for a page here
vi.mock('./onboarding/state', () => ({ onboardingFinished: () => true, onboardingPutOff: () => true, browserStorage: () => null, recordImportOutcome: () => undefined }));
// the device index sweep and the folder watch, counted where the shell reaches them
vi.mock('../media', async (importOriginal) => {
  const real = await importOriginal<typeof import('../media')>();
  return { ...real, findLapsed: vi.fn(real.findLapsed), listWatchedFolders: vi.fn(real.listWatchedFolders) };
});

const media = await import('../media');
const { CloudApp } = await import('./CloudApp');
await import('./CloudShell');

type Row = { id: number; title: string; artist: string; available_on: number; content_sha256?: string; cloud?: { asset_id: string; bytes: number; format: string | null; copies: number } | null };

let account: Account;
let songs: Row[] = [];
/** What /api/events answers: null is a blocked stream, so the page polls. */
let events: string | null = null;
let requests: { method: string; url: string; body: string }[] = [];

/** An account as the server decides it: music on devices (`device`), the cloud library grant
 * (`cloud`), cloud.local_first, and cloud.one_shell (with what it needs). */
function member({ device, cloud, localFirst = device, oneShell = true, workspace = 'ws-1' }: { device: boolean; cloud: boolean; localFirst?: boolean; oneShell?: boolean; workspace?: string }): Account {
  const base = cloudAccount();
  return {
    ...base,
    workspace: { ...base.workspace, id: workspace },
    experience: { local_first: device, hosted: cloud },
    features: {
      'cloud.local_first': localFirst, 'cloud.hosted_media': cloud, 'cloud.hosted_shell': true,
      'library.places': true, 'cloud.account_mixes': true, 'cloud.one_shell': oneShell,
      // what the server decides off with cloud.local_first off (each needs it)
      ...(localFirst ? {} : { 'cloud.workspace': false, 'cloud.offline_shell': false, 'cloud.mix_outbox': false, 'tools.listening_room': false, 'cloud.one_mixer': false }),
    },
  };
}

/** The sweeps and folder loads made for one workspace (an earlier test's may still be running). */
const sweptFor = (workspace: string) => vi.mocked(media.findLapsed).mock.calls.filter(([store]) => store.workspaceId === workspace).length;
const foldersFor = (workspace: string) => vi.mocked(media.listWatchedFolders).mock.calls.filter(([id]) => id === workspace).length;

beforeEach(() => {
  songs = [];
  events = null;
  requests = [];
  vi.mocked(media.findLapsed).mockClear();
  vi.mocked(media.listWatchedFolders).mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : '' });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url === '/api/events') {
      if (events === null) throw new TypeError('blocked');
      return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.startsWith('/api/local-media/songs')) return json({ songs });
    if (url === '/api/devices' && init?.method === 'POST') {
      return json({ device: { id: 'dev-1', name: 'This browser', kind: 'desktop', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 1, warnings: [] }, notice: null });
    }
    if (url.startsWith('/api/playback/session')) return json({ session: null, speaker: 'none', speaker_device_id: null, speaker_name: null, ask_before_playing_here: false, server_time: Date.now() / 1000 });
    if (url.startsWith('/api/uploads')) return json({ uploads: [] });
    if (url.startsWith('/api/assets?')) return json({ assets: [], next_cursor: null });
    if (url === '/api/account/lucy') return json({ enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false }, privacy: { share_lyrics: false, share_history: false }, tier: 'Lucy Basic', usage: { used: 0, limit: 40, fair_use: false, resets_at: null } });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  setAccountFeatures(null);
  setFlags({});
  window.history.replaceState({}, '', '/');
});

const mainNav = () => screen.findByRole('navigation', { name: 'Main' });
const link = (nav: HTMLElement, label: string) => nav.querySelector(`a[aria-label="${label}"]`);
const settle = () => new Promise((done) => setTimeout(done, 300));

describe('with cloud.one_shell on, every account opens the Cloud shell', () => {
  it('keeps music on this device as it was for a device-music account', async () => {
    account = member({ device: true, cloud: false });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const nav = await mainNav();
    for (const label of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) expect(nav.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect(link(nav, 'Workspace')).toHaveAttribute('href', '/workshop');
    expect(screen.queryByRole('navigation', { name: 'Cloud workspace' })).toBeNull();
    expect(screen.queryByText(CLOUD_ONLY_FOOTER)).toBeNull();
  });

  it('keeps both places for an account with songs on its devices and in its cloud library', async () => {
    account = member({ device: true, cloud: true });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const nav = await mainNav();
    expect(link(nav, 'Workspace')).not.toBeNull();
    expect(link(nav, 'Upload music')).toHaveAttribute('href', '/upload');
    expect(screen.queryByText(CLOUD_ONLY_FOOTER)).toBeNull();
  });

  it('opens it cloud only for an account whose songs are only in its cloud library', async () => {
    account = member({ device: false, cloud: true });
    render(<CloudApp />);
    const nav = await mainNav();
    for (const label of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) expect(nav.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect(link(nav, 'Workspace')).toBeNull();
    expect(link(nav, 'This device')).toBeNull();
    expect(link(nav, 'Upload music')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Cloud workspace' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Overview' })).toBeNull();
    expect(await screen.findByText(CLOUD_ONLY_FOOTER)).toBeInTheDocument();
  });

  it('opens it cloud only, never the older pages, with cloud.local_first off for the account', async () => {
    account = member({ device: true, cloud: true, localFirst: false });
    render(<CloudApp />);
    const nav = await mainNav();
    expect(link(nav, 'Workspace')).toBeNull();
    expect(nav.querySelector('[aria-label="My Mixes"]')).not.toBeNull();
    expect(await screen.findByText(CLOUD_ONLY_FOOTER)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Cloud workspace' })).toBeNull();
  });
});

describe('with cloud.one_shell off, the routing is exactly as before', () => {
  it('gives a cloud library account the older pages in the shared shell', async () => {
    account = member({ device: false, cloud: true, oneShell: false });
    render(<CloudApp />);
    const nav = await mainNav();
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(nav.querySelector('[aria-label="My Mixes"]')).toBeNull();
    expect(screen.queryByText(CLOUD_ONLY_FOOTER)).toBeNull();
  });

  it('gives the legacy rail when the server never names it, as an older server does', async () => {
    account = { ...member({ device: false, cloud: true }), features: { 'cloud.local_first': false, 'cloud.hosted_media': true } };
    render(<CloudApp />);
    expect(await screen.findByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('keeps a device-music account in the Cloud shell with its device places', async () => {
    account = member({ device: true, cloud: false, oneShell: false });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    expect(link(await mainNav(), 'Workspace')).not.toBeNull();
  });
});

describe('the cloud-only profile', () => {
  it('connects by uploading without sweeping this device or watching folders', async () => {
    account = member({ device: false, cloud: true, workspace: 'ws-cloud' });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Connect your first songs' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    const connect = within(main).getByRole('button', { name: 'Connect music' });
    expect(connect).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(connect);
    expect(connect).toHaveAttribute('aria-expanded', 'true');
    expect(await within(main).findByText('Choose music files')).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(/Choose (a|your music) folder/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Onboarding' })).toBeNull();
    expect(sweptFor('ws-cloud')).toBe(0);
    expect(foldersFor('ws-cloud')).toBe(0);
  });

  it('is the contrast: an account with music on its devices sweeps them and watches its folders', async () => {
    account = member({ device: true, cloud: false, workspace: 'ws-device' });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    await mainNav();
    await waitFor(() => expect(sweptFor('ws-device')).toBeGreaterThan(0));
    await waitFor(() => expect(foldersFor('ws-device')).toBeGreaterThan(0));
  });

  it('shows the cloud library songs with nothing about this device', async () => {
    account = member({ device: false, cloud: true });
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 0, content_sha256: 'aa', cloud: { asset_id: 'a1', bytes: 4_000_000, format: 'mp3', copies: 1 } }];
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    expect(await screen.findByText('Your songs, kept in your cloud library.')).toBeInTheDocument();
    expect(await screen.findByText('Blue')).toBeInTheDocument();
    expect(screen.queryByTestId('library-here')).toBeNull();
    expect(screen.queryByRole('button', { name: 'On this device' })).toBeNull();
    expect(screen.queryByText(/on this device/i)).toBeNull();
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Connect music' })).toBeInTheDocument();
  });

  it('says to upload on an empty Make a Mix and Listen, never to connect a folder', async () => {
    account = member({ device: false, cloud: true });
    window.history.replaceState({}, '', '/mixes');
    const { unmount } = render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Upload songs to make a mix' })).toBeInTheDocument();
    expect(screen.queryByText(/Connect your music/)).toBeNull();
    unmount();
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Upload songs to start listening' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Upload music' }).some((one) => one.getAttribute('href') === '/upload')).toBe(true);
  });

  it('plays through the shared engine, registered as this tab\'s speaker for remotes, Rooms and Lucy', async () => {
    account = member({ device: false, cloud: true });
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 0, cloud: { asset_id: 'a1', bytes: 4_000_000, format: 'mp3', copies: 1 } }];
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    await mainNav();
    // the playback device the session commands reach (ADR-0461, T-20261125-dfa3)
    await waitFor(() => expect(requests.some((sent) => sent.method === 'POST' && sent.url === '/api/devices')).toBe(true));
    const registered = JSON.parse(requests.find((sent) => sent.method === 'POST' && sent.url === '/api/devices')!.body) as { capabilities?: unknown };
    expect(registered.capabilities).toBeTruthy();
    await waitFor(() => expect(requests.some((sent) => sent.url.startsWith('/api/playback/session?device_id=dev-1'))).toBe(true));
    // never the older card's own player
    expect(screen.queryByRole('button', { name: 'Play the mix' })).toBeNull();
  });
});

describe('the Labs switch, music on your devices', () => {
  const flagsChanged = 'event: selecta\ndata: {"topic":"flags.changed","payload":{"version":7}}\n\n';

  it('only hides the device features: the Cloud shell stays mounted', async () => {
    events = flagsChanged;
    account = member({ device: true, cloud: true });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const nav = await mainNav();
    expect(link(nav, 'Workspace')).not.toBeNull();
    // leaving Labs: the rule that put cloud.local_first on is gone
    account = member({ device: false, cloud: true, localFirst: false });
    await waitFor(() => expect(link(nav, 'Workspace')).toBeNull(), { timeout: 8000 });
    expect(screen.getByRole('navigation', { name: 'Main' })).toBe(nav);
    expect(screen.queryByRole('navigation', { name: 'Cloud workspace' })).toBeNull();
    expect(await screen.findByText(CLOUD_ONLY_FOOTER)).toBeInTheDocument();
  });

  it('is the contrast: with cloud.one_shell off, leaving swaps the frame', async () => {
    events = flagsChanged;
    account = member({ device: true, cloud: true, oneShell: false });
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const nav = await mainNav();
    account = member({ device: false, cloud: true, localFirst: false, oneShell: false });
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBe(nav), { timeout: 8000 });
  });
});
