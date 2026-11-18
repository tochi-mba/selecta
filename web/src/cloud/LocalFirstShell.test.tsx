import { configure, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures, setFlags } from '../flags';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';

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
vi.mock('./onboarding/state', () => ({ onboardingFinished: () => false }));
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
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
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

  it('Make a Mix says why there are no ideas yet once songs are connected', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Your songs are connected' })).toBeVisible();
    expect(screen.getByText(/measuring in the browser is not available yet/)).toBeVisible();
  });

  it('My Mixes with no mix offers to make one', async () => {
    account = withExperience(true, false, true);
    songs = [{ id: 1, title: 'Blue', artist: 'Moon', available_on: 1 }];
    window.history.replaceState({}, '', '/mixes/mine');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'No mixes yet' })).toBeVisible();
  });
});
