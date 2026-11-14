import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloudAccount } from '../../test/cloudAccount';
import type { Account } from '../api';

const auth = vi.hoisted(() => ({
  user: { id: 'person', email: 'person@example.test', emailVerified: true },
  token: async () => 'token',
}));
vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({
    isLoading: false, user: auth.user,
    getAccessToken: auth.token, signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  }),
}));
vi.mock('../events', () => ({ useCloudEvents: () => 'connected' }));
const { CloudApp } = await import('../CloudApp');

let account: Account;
const requests: string[] = [];
beforeEach(() => {
  account = {
    ...cloudAccount(),
    features: {
      'local_first.personal': true,
      'cloud.account_states': true,
      'cloud.uploads': false,
      'cloud.mix_create': true,
    },
  };
  requests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    requests.push(input);
    if (input === '/api/account') return new Response(JSON.stringify(account), { status: 200 });
    if (input === '/api/cloud-mixes?schema_version=2') return new Response(JSON.stringify({ recipes: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/');
});
describe('BR64-07 Cloud flag combinations and route continuity', () => {
  it('keeps the player status, Studio and editing entry accessible under local-first', async () => {
    window.history.replaceState({}, '', '/studio');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'My Mixes and Studio' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Browser-local music player' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Personal browser Studio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Without Music' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /local engine/i })).not.toBeInTheDocument();
    expect(requests.every((url) => !url.includes('/cloud-audio') && !url.includes('/assets'))).toBe(true);
  });
  it('keeps Cloud navigation and access to local Library with legacy upload flag off', async () => {
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Your music workspace, on any device.' })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Cloud workspace' });
    expect(within(navigation).getByRole('button', { name: 'My Mixes / Studio' })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: 'Connect local music' })).toBeInTheDocument();
    await userEvent.click(within(navigation).getByRole('button', { name: 'My Mixes / Studio' }));
    await waitFor(() => expect(window.location.pathname).toBe('/listen'));
    expect(screen.getByRole('region', { name: 'Browser-local music player' })).toBeInTheDocument();
  });
  it('does not confuse the obsolete native-engine experiment flag with browser-first mode', async () => {
    account.features['local_first.personal'] = false;
    account.features['local_first.player_v1'] = true;
    account.features['cloud.single_audio_owner'] = true;
    render(<CloudApp />);
    await screen.findByText('CURRENT PLAN'); // Wait for hosted-account render, not just the fetch request.
    expect(requests).toContain('/api/account');
    expect(screen.queryByTestId('br64-01-browser-player')).not.toBeInTheDocument();
  });

  it('still exposes account settings and avoids turning the old hosted dock back on', async () => {
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    await screen.findByRole('heading', { level: 1, name: 'Account settings' });
    expect(screen.getByRole('region', { name: 'Browser-local music player' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /local engine/i })).not.toBeInTheDocument();
  });
});
