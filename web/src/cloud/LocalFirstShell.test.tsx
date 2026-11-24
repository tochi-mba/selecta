import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures, setFlags } from '../flags';
import { cloudAccount } from '../test/cloudAccount';
import type { ImportEvent, ImportSummary } from '../media';
import type { Account } from './api';
import { cancelImportSession, clearImportMarker, clearImportSession, IMPORT_SUSPENDED, importSnapshot, readImportMarker, startImportSession } from './importSession';

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
const spine = vi.hoisted(() => ({ throws: false }));
vi.mock('./onboarding/OnboardingSpine', () => ({
  OnboardingSpine: ({ workspaceId }: { workspaceId: string }) => {
    if (spine.throws) throw new Error('spine broke');
    return <section aria-label="Onboarding">{`spine for ${workspaceId}`}</section>;
  },
}));
const recorded = vi.hoisted(() => [] as unknown[]);
vi.mock('./onboarding/state', () => ({ onboardingFinished: () => false, onboardingPutOff: () => false, browserStorage: () => null, recordImportOutcome: (_storage: unknown, _ws: string, summary: unknown) => { recorded.push(summary); } }));
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
  spine.throws = false;
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
    // the browser Workspace (cloud.workspace) is linked from the rail; More is for phones only
    expect(main.querySelector('a[aria-label="Workspace"]')).toHaveAttribute('href', '/workshop');
    expect(main.querySelector('button.nav-more-mobile')).not.toBeNull();
    expect(main.querySelector('button[aria-label="More"]')).toBeNull();
  });

  it('keeps Workspace out of the rail with cloud.workspace off', async () => {
    account = { ...withExperience(true, false, true), features: { 'cloud.local_first': true, 'cloud.hosted_media': false, 'cloud.workspace': false } };
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const main = await screen.findByRole('navigation', { name: 'Main' });
    expect(main.querySelector('[aria-label="Workspace"]')).toBeNull();
    expect(main.querySelector('button.nav-more-mobile')).not.toBeNull();
  });
});

describe('the side bar account menu', () => {
  it('lists the account pages and Sign out at the foot of the side bar', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const main = await screen.findByRole('navigation', { name: 'Main' });
    const opener = within(main).getByRole('button', { name: /^Account: / });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener);
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Account', 'Plan & billing', 'Sign out']);
    expect(within(menu).getByRole('menuitem', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Account' })).toBeNull();
  });
});

describe('Workspace in the local-first shell (cloud.workspace)', () => {
  const member = (features: Record<string, boolean> = {}): Account => ({
    ...withExperience(true, false, true),
    features: { 'cloud.local_first': true, 'cloud.hosted_media': false, ...features },
  });
  const openMore = async () => {
    const main = await screen.findByRole('navigation', { name: 'Main' });
    // the phone's More (a computer lists these places in the side bar and the account menu)
    fireEvent.click(main.querySelector('button.nav-more-mobile')!);
    return screen.findByRole('navigation', { name: 'More' });
  };

  it('opens the browser Workspace at /workshop, with the tabs a browser can fill', async () => {
    account = member();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/workshop');
    render(<CloudApp />);
    // the page settles once the shell has set what a browser cannot do, so each look is retried
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeVisible());
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getAllByRole('link').map((tab) => tab.textContent))
      .toEqual(['Overview', 'Sources', 'Storage', 'Diagnostics']));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Activity' })).toBeVisible());
    expect(screen.queryByRole('heading', { level: 1, name: 'This device' })).toBeNull();
  });

  it('says Analysis belongs to SelectaDJ on a computer', async () => {
    account = member();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/workshop/analysis');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Analysis is part of SelectaDJ on your computer' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Workspace' })).toHaveAttribute('href', '/workshop');
  });

  it('lists Workspace first in More, and This device no longer', async () => {
    account = member();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const links = within(await openMore()).getAllByRole('link').map((link) => link.getAttribute('aria-label'));
    expect(links[0]).toBe('Workspace');
    expect(links).toContain('Account');
    expect(links).not.toContain('This device');
  });

  it('moves what this browser keeps off Account and onto Workspace > Storage', async () => {
    account = member();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/account');
    const onAccount = render(<CloudApp />);
    await screen.findByRole('region', { name: 'Signed in as' });
    expect(screen.queryByRole('heading', { name: 'What this browser keeps' })).toBeNull();
    onAccount.unmount();
    window.history.replaceState({}, '', '/workshop/storage');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'What this browser keeps' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Browser storage' })).toBeVisible();
  });

  it('keeps This device in More and the device card on Account with the flag off', async () => {
    account = member({ 'cloud.workspace': false });
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/workshop');
    const device = render(<CloudApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This device' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
    const links = within(await openMore()).getAllByRole('link').map((link) => link.getAttribute('aria-label'));
    expect(links).toContain('This device');
    expect(links).not.toContain('Workspace');
    device.unmount();
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'What this browser keeps' })).toBeVisible();
  });
});

describe('what the shell answers in the browser for the newer pages', () => {
  const member = (features: Record<string, boolean> = {}): Account => ({
    ...withExperience(true, false, true),
    features: { 'cloud.local_first': true, 'cloud.hosted_media': false, ...features },
  });
  const called = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

  it('shows Harmonic matches from this browser, never asking a server for discoveries', async () => {
    account = member();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/discover/harmonic');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Songs whose keys line up' })).toBeVisible();
    expect(await screen.findByText(/No harmonic matches yet\. They turn up as more of the songs on this device are measured\./)).toBeVisible();
    expect(called().some((url) => url.includes('/discoveries'))).toBe(false);
  });

  it('has no Harmonic matches page with cloud.browser_harmonic off', async () => {
    account = member({ 'cloud.browser_harmonic': false });
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/discover/harmonic');
    render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(screen.getAllByRole('main')).toHaveLength(1));
    expect(screen.queryByRole('heading', { level: 2, name: 'Songs whose keys line up' })).toBeNull();
  });

  it('shows Word connections from the Cloud lyric links, with the browser’s own words', async () => {
    account = member();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }, { id: 2, title: 'Red', artist: 'Sun', available_on: 1 }];
    const fetcher = vi.mocked(globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    const fallback = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/local-media/links')) {
        return new Response(JSON.stringify({
          links: [{ phrase: 'all night', kind: 'echo', a: 1, b: 2, artist_a: 'Moon', title_a: 'Blue', artist_b: 'Sun', title_b: 'Red', line_a: 'we ran all night', line_b: 'all night I waited', score: 0.9, moves: [] }],
          found: 1, lyrics: { songs: 2, checked: 2, synced: 2, waiting: 0, looked_up: 2, looking_up: false },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return fallback(url, init);
    });
    window.history.replaceState({}, '', '/discover');
    render(<CloudApp />);
    expect(await screen.findByRole('button', { name: 'Add both to the mix' }, { timeout: 10_000 })).toBeVisible();
    expect(screen.getByRole('main')).toHaveTextContent(/found from your songs’ lyrics\. Pair two songs and SelectaDJ works out the transition as the mix plays\./);
    expect(screen.queryByRole('button', { name: 'Render it now' })).toBeNull();
    // the browser's pair cards need no draft names, and no local draft route is asked
    expect(called().some((url) => url.includes('/api/drafts'))).toBe(false);
  });
});

describe('what the local-first shell mounts', () => {
  it('meets a new member with the onboarding spine', async () => {
    account = withExperience(true, false, true);
    render(<CloudApp />);
    expect(await screen.findByLabelText('Onboarding')).toHaveTextContent('spine for ws-1');
    expect(screen.queryByLabelText('Cutover notice')).toBeNull();
  });

  it('keeps the shell standing when one page throws: the page alone says it stopped (L1)', async () => {
    account = withExperience(true, false, true);
    spine.throws = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { level: 1, name: /stopped working\.$/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start this page again' })).toBeVisible();
    // the shell around the page is still there
    expect(screen.getByText(/SelectaDJ Cloud\. Your music files stay on your devices/)).toBeVisible();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    quiet.mockRestore();
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

describe('the Library Connect music menu', () => {
  it('has a name, opens from the keyboard on its first item, and Escape gives focus back', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const trigger = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: 'Connect music' }).find((button) => button.getAttribute('aria-expanded') !== null);
      expect(found).toBeDefined();
      return found!;
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Choose a folder', 'Choose songs']);
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe('designed empty states, never a blank table', () => {
  it('Listen with nothing to play points at the next step', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Choose your music again to listen' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Connect music' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Make a Mix says why there is no mix yet when too few songs play on this device', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Choose your music again to make a mix' })).toBeVisible();
    expect(screen.getByText(/This browser lets go of your music when the page closes, so choose your 1 song again/)).toBeVisible();
  });

  it('My Mixes with no current mix offers a next step', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes/mine');
    render(<CloudApp />);
    // the page is drawn twice while the library answers, so each look is retried
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'My Mixes' })).toBeVisible();
      // the next step: the page's own way to Make a Mix
      const next = [...document.querySelectorAll<HTMLElement>('main a, main button')].find((control) => control.textContent?.trim() === 'Make a mix');
      expect(next).toBeVisible();
    });
  });

  it('loads browser recipe drafts through the Cloud request boundary, not the local draft route', async () => {
    account = {
      ...withExperience(true, false, true),
      features: { 'cloud.local_first': true, 'cloud.hosted_media': false, drafts: true },
    };
    // A connected library makes this a returning account, so the shell reaches My Mixes.
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes/mine');
    const calls: string[] = [];
    const fetcher = vi.mocked(globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>);
    const fallback = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/local-media/recipes') {
        return new Response(JSON.stringify({ recipes: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return fallback(url, init);
    });

    render(<CloudApp />);

    expect(await screen.findByRole('heading', { name: 'No saved mixes yet' })).toBeVisible();
    // the saved list sits inside My Mixes' own main landmark, never after it (L1)
    const saved = screen.getByRole('heading', { name: 'Saved mixes' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toContainElement(saved);
    expect(calls).toContain('GET /api/local-media/recipes');
    expect(calls.some((call) => call.includes('kind='))).toBe(false);
    expect(calls.some((call) => call.includes('/api/drafts'))).toBe(false);
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
    // Lucy's own section of Account, with the tier the plan carries
    expect(await screen.findByRole('heading', { name: 'Lucy on your plan' })).toBeVisible();
    expect(await screen.findByText('Lucy Basic')).toBeVisible();
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
/** Starts an import the test drives; resolves once the run has begun (with cloud.resilient_import
 * the session first claims the import across tabs, so the run starts a moment later). */
async function heldImport() {
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
  await waitFor(() => expect(signal).not.toBeNull());
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
    const held = await heldImport();
    held.emit({ kind: 'collected', total: 4, skipped: 0 });
    held.emit({ kind: 'checked', name: 'a.mp3', resumed: false });
    held.emit({ kind: 'file', name: 'a.mp3', stage: 'done', songId: 2 });
    const chip = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.cloud-import-chip');
      expect(found).toHaveTextContent('1 of 4 checked');
      return found!;
    });
    expect(chip).toHaveTextContent('Adding your music');
    expect(within(chip).getByRole('button', { name: /See (import )?progress/ })).toBeVisible();
    held.finish({ imported: 1, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false });
    await waitFor(() => expect(document.querySelector('.cloud-import-chip')).toBeNull());
    expect(recorded).toEqual([{ imported: 1, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false }]);
  });

  it('reads the counts again on each landed batch', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(songListings()).toBeGreaterThan(0));
    const held = await heldImport();
    const before = songListings();
    held.emit({ kind: 'batch', registered: 5 });
    await waitFor(() => expect(songListings()).toBeGreaterThan(before));
  });

  it('keeps the spine mounted when songs land mid-import', async () => {
    account = withExperience(true, false, true);
    render(<CloudApp />);
    expect(await screen.findByLabelText('Onboarding')).toBeVisible();
    const held = await heldImport();
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    const before = songListings();
    held.emit({ kind: 'batch', registered: 1 });
    await waitFor(() => expect(songListings()).toBeGreaterThan(before));
    await new Promise((settled) => setTimeout(settled, 50));
    expect(screen.getByLabelText('Onboarding')).toBeVisible();
  });

  it('pauses the import and keeps its record when the shell itself goes (cloud.resilient_import)', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    const view = render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    const held = await heldImport();
    view.unmount();
    expect(held.signal()?.aborted).toBe(true);
    expect(held.signal()?.reason).toBe(IMPORT_SUSPENDED);
    expect(readImportMarker('ws-1')).toMatchObject({ kept: true });
  });
});

describe('the server-free palette and keys in the local-first shell (W5 subset)', () => {
  const member = (features: Record<string, boolean> = {}): Account => ({
    ...cloudAccount(),
    experience: { local_first: true, hosted: false },
    features: { 'cloud.local_first': true, 'cloud.account_states': true, ...features },
  });
  const press = (key: string, more: Partial<KeyboardEventInit> = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...more })); });

  it('opens Ctrl K with this shell’s own places and nothing that needs a local server', async () => {
    account = member();
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    await screen.findByRole('region', { name: 'Signed in as' });
    press('k', { ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Search and commands' });
    const options = within(palette).getAllByRole('option').map((option) => option.getAttribute('aria-label'));
    // Workspace is one of this shell's places now (cloud.workspace): the browser's own page
    for (const place of ['Page: Listen', 'Page: Make a Mix', 'Page: My Mixes', 'Page: Library', 'Page: Workspace', 'Page: Account']) expect(options).toContain(place);
    expect(options).not.toContain('Page: This device');
    expect(options.some((label) => /Play|Pause/.test(label ?? ''))).toBe(true);
    for (const local of [/Request a song/, /Undo/, /Analyse/, /Edit current mix/]) expect(options.some((label) => local.test(label ?? ''))).toBe(false);
    const box = within(palette).getByRole('combobox');
    fireEvent.change(box, { target: { value: 'blue moon' } });
    await new Promise((settled) => setTimeout(settled, 250));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/library?q='))).toBe(false);
    expect(within(palette).queryByText(/Search your library for/)).toBeNull();
  });

  it('lists only the server-free keys in its help', async () => {
    account = member();
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    await screen.findByRole('region', { name: 'Signed in as' });
    press('?');
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    // N too: Listen's own Jump to the transition button names it, and it acts on the browser player
    for (const shown of ['Play or pause', 'Jump to the transition', 'Next song', 'Previous song', 'Mute', 'Search and commands', 'This list']) expect(help).toHaveTextContent(shown);
    for (const hidden of ['Request a song', 'Undo', 'Search your library', 'Fullscreen lyrics']) expect(help).not.toHaveTextContent(hidden);
  });

  it('has no palette or help with the flags off, and its buttons are gone', async () => {
    account = member({ 'app.command_palette': false, 'app.shortcuts': false });
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    await screen.findByRole('region', { name: 'Signed in as' });
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
    press('k', { ctrlKey: true });
    press('?');
    await new Promise((settled) => setTimeout(settled, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
