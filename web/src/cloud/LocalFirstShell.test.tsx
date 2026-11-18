import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures, setFlags } from '../flags';
import { cloudAccount } from '../test/cloudAccount';
import type { ImportEvent, ImportSummary } from '../media';
import type { Account } from './api';
import { cancelImportSession, clearImportMarker, clearImportSession, importSnapshot, startImportSession } from './importSession';

// ADR-0462/0463 mounting rules: the shared shell only for an account with the local-first
// experience AND `cloud.local_first` on; otherwise the hosted pages exactly as before. New
// members meet the onboarding spine; grandfathered hosted accounts see the cutover notice.

// The shell is a lazy chunk: its first load in a busy run takes longer than the default second.
configure({ asyncUtilTimeout: 10_000 });

const auth = vi.hoisted(() => ({ user: { id: 'user-1', email: 'listener@example.test', emailVerified: true } as unknown }));
vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({ isLoading: false, user: auth.user, getAccessToken: async () => 'token', signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn() }),
}));
// The two contracts owned elsewhere, stood in by markers so this file tests only where they mount.
vi.mock('./onboarding/OnboardingSpine', () => ({
  OnboardingSpine: ({ workspaceId }: { workspaceId: string }) => <section aria-label="Onboarding">{`spine for ${workspaceId}`}</section>,
}));
const recorded = vi.hoisted(() => [] as unknown[]);
vi.mock('./onboarding/state', () => ({ onboardingFinished: () => false, browserStorage: () => null, recordImportOutcome: (_storage: unknown, _ws: string, summary: unknown) => { recorded.push(summary); } }));
vi.mock('./migration/CutoverNotice', () => ({
  CutoverNotice: ({ accountId }: { accountId: string }) => <aside aria-label="Cutover notice">{`notice for ${accountId}`}</aside>,
}));

const { CloudApp } = await import('./CloudApp');

let account: Account;
let songs: { id: number; title: string; artist: string; available_on: number }[] = [];

const withExperience = (local_first: boolean, hosted: boolean, flag: boolean): Account => ({
  ...cloudAccount(),
  experience: { local_first, hosted },
  features: { 'cloud.local_first': flag, 'cloud.hosted_media': hosted },
});

beforeEach(() => {
  songs = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url === '/api/events') throw new TypeError('blocked');
    if (url.startsWith('/api/local-media/songs')) return json({ songs });
    if (url.startsWith('/api/uploads')) return json({ uploads: [] });
    if (url.startsWith('/api/assets?')) return json({ assets: [], next_cursor: null });
    if (url === '/api/account/lucy') return json({ enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false }, privacy: { share_lyrics: false, share_history: false }, tier: 'Lucy Basic', usage: { used: 0, limit: 40, fair_use: false, resets_at: null } });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(async () => {
  // only a test that started an import waits for it to settle: an act() around a wait would
  // also flush the shell's own live updates, which never go quiet in some account states
  cleanup();
  if (importSnapshot().phase !== 'idle') {
    cancelImportSession();
    await new Promise((settled) => setTimeout(settled, 0));
    clearImportSession();
  }
  clearImportMarker('ws-1');
  recorded.length = 0;
  setAccountFeatures(null);
  setFlags({});
  window.history.replaceState({}, '', '/');
});

describe('which shell an account gets', () => {
  it('keeps the hosted pages when the account has no local-first experience', async () => {
    account = withExperience(false, true, true);
    render(<CloudApp />);
    expect(await screen.findByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('keeps the hosted pages when cloud.local_first is off, even with the experience', async () => {
    account = withExperience(true, false, false);
    render(<CloudApp />);
    expect(await screen.findByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('opens the shared shell with the four music destinations when both hold', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const main = await screen.findByRole('navigation', { name: 'Main' });
    for (const label of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) expect(main.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Cloud workspace' })).toBeNull();
    // no Workspace in the Cloud rail: it lives in More
    expect(main.querySelector('[aria-label="Workspace"]')).toBeNull();
    expect(main.querySelector('[aria-label="More"]')).not.toBeNull();
  });
});

describe('what the local-first shell mounts', () => {
  it('meets a new member with the onboarding spine', async () => {
    account = withExperience(true, false, true);
    render(<CloudApp />);
    expect(await screen.findByLabelText('Onboarding')).toHaveTextContent('spine for ws-1');
    expect(screen.queryByLabelText('Cutover notice')).toBeNull();
  });

  it('shows a grandfathered hosted account the cutover notice', async () => {
    account = withExperience(true, true, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    render(<CloudApp />);
    expect(await screen.findByLabelText('Cutover notice')).toHaveTextContent('notice for user-1');
  });

  it('never shows a local-first member the upload surface', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/upload');
    render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add music' })).toBeNull());
    expect(screen.getByRole('link', { name: /Go to Library/ })).toBeVisible();
  });
});

describe('designed empty states, never a blank table', () => {
  it('Listen with nothing to play points at the next step', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Nothing is playing' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Make a Mix' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Make a Mix says why there is no mix yet when too few songs play on this device', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Your songs are connected' })).toBeVisible();
    expect(screen.getByText(/fewer than two can play on this device/)).toBeVisible();
  });

  it('My Mixes with no mix offers to make one', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes/mine');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'No mixes yet' })).toBeVisible();
  });
});

describe('the account chrome in the local-first shell (hosted frame parity)', () => {
  const localFirst = (features: Record<string, boolean> = {}, user: Partial<Account['user']> = {}, base: Account = cloudAccount()): Account => ({
    ...base,
    user: { ...base.user, ...user },
    experience: { local_first: true, hosted: false },
    features: { 'cloud.local_first': true, 'cloud.account_states': true, ...features },
  });

  it('shows who is signed in and Sign out in More > Account, and no staff console for a member', async () => {
    account = localFirst();
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    const strip = await screen.findByRole('region', { name: 'Signed in as' });
    expect(strip).toHaveTextContent('listener@example.test');
    expect(within(strip).getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Staff console' })).toBeNull();
  });

  it('offers the staff console only to staff', async () => {
    account = localFirst({ 'admin.console': true }, { staff: true });
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    expect(await screen.findByRole('button', { name: 'Staff console' })).toBeVisible();
  });

  it('reaches Lucy settings when the plan includes Lucy, though the shell turns Lucy mixing off', async () => {
    account = localFirst({ lucy: true, 'account.lucy_settings': true });
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Lucy Basic' })).toBeVisible();
  });

  it('mounts the reconciliation only for a grandfathered account with stored media', async () => {
    account = { ...localFirst({ 'cloud.stored_media': true }), experience: { local_first: true, hosted: true } };
    window.history.replaceState({}, '', '/account');
    const hosted = render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'How your libraries line up' })).toBeVisible();
    hosted.unmount();
    account = localFirst({ 'cloud.stored_media': true });
    render(<CloudApp />);
    await screen.findByRole('region', { name: 'Signed in as' });
    expect(screen.queryByRole('heading', { name: 'How your libraries line up' })).toBeNull();
  });

  it('shows the Rooms plan teaser only while a plan locks Rooms', async () => {
    account = { ...localFirst({ rooms: false }), feature_locks: { rooms: 'premium' } };
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    expect(await screen.findByRole('button', { name: 'Explore Premium' })).toBeVisible();
  });

  it('carries the suspended, over-quota and paused-updates notices in its banner, and a truthful footer', async () => {
    account = localFirst({}, { suspended: true }, cloudAccount({ used: 12e9, limit: 10e9 }));
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/library');
    const { container } = render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(await screen.findByText(/Live updates are paused on this network/)).toBeVisible();
    expect(screen.getByText(/You’re 2.0 GB over Free’s 10.0 GB/)).toBeVisible();
    expect(container.querySelector('.cloud-suspended')).not.toBeNull();
    expect(container.querySelector('.cloud-footer')).toHaveTextContent('Your music files stay on your devices; your account keeps their details.');
  });
});

/** An import the test drives by hand, started on the session the shell subscribes to. */
function heldImport() {
  let emit: (event: ImportEvent) => void = () => {};
  let finish: (summary: ImportSummary) => void = () => {};
  let signal: AbortSignal | null = null;
  act(() => {
    void startImportSession({
      source: [],
      workspaceId: 'ws-1',
      run: (_source, onProgress, abort) => {
        emit = onProgress;
        signal = abort;
        return new Promise<ImportSummary>((resolve) => {
          finish = resolve;
          abort.addEventListener('abort', () => resolve({ imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: true, paused: false }));
        });
      },
    });
  });
  return { emit: (event: ImportEvent) => act(() => emit(event)), finish: (summary: ImportSummary) => finish(summary), signal: () => signal };
}

const songListings = () => (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([url]) => url.startsWith('/api/local-media/songs')).length;

describe('the import session in the shell (BF-0463-02 progressive import)', () => {
  it('shows the import chip with its counts while an import runs, and it goes when the import ends', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    const held = heldImport();
    held.emit({ kind: 'collected', total: 4, skipped: 0 });
    held.emit({ kind: 'file', name: 'a.mp3', stage: 'done', songId: 2 });
    expect(await screen.findByText('Checking your music: 1 of 4 checked.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View' })).toBeVisible();
    held.finish({ imported: 1, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false });
    await waitFor(() => expect(screen.queryByText(/Checking your music:/)).toBeNull());
    expect(recorded).toEqual([{ imported: 1, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false }]);
  });

  it('reads the counts again on each landed batch', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(songListings()).toBeGreaterThan(0));
    const held = heldImport();
    const before = songListings();
    held.emit({ kind: 'batch', registered: 5 });
    await waitFor(() => expect(songListings()).toBeGreaterThan(before));
  });

  it('keeps the spine mounted when songs land mid-import', async () => {
    account = withExperience(true, false, true);
    render(<CloudApp />);
    expect(await screen.findByLabelText('Onboarding')).toBeVisible();
    const held = heldImport();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    const before = songListings();
    held.emit({ kind: 'batch', registered: 1 });
    await waitFor(() => expect(songListings()).toBeGreaterThan(before));
    await new Promise((settled) => setTimeout(settled, 50));
    expect(screen.getByLabelText('Onboarding')).toBeVisible();
  });

  it('cancels the import when the shell itself goes', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    const view = render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    const held = heldImport();
    view.unmount();
    expect(held.signal()?.aborted).toBe(true);
  });
});
