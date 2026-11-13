import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../../test/cloudAccount';
import type { Api } from '../api';
import { CloudError } from '../api';
import { ConnectLocalMusic, DeviceHome, DeviceLibrary } from './PersonalWorkspace';

const fresh = () => new Date().toISOString();
const snapshot = () => ({
  schema_version: 1,
  devices: [
    { id: 'studio-1', display_name: 'Studio PC', role: 'engine', engine_state: 'ready', connectivity: 'online', output_state: 'verified', last_verified_at: fresh(), verified_tracks: 5, total_tracks: 8 },
    { id: 'phone-2', display_name: 'Phone', role: 'controller', engine_state: 'unknown', connectivity: 'online', last_verified_at: fresh() },
  ],
  sources: [{ id: 'drive-1', device_id: 'studio-1', display_name: 'External drive', state: 'source_disconnected', last_scanned_at: fresh(), total_tracks: 8, analysed_tracks: 5, unsupported_tracks: 1 }],
  recent_recipes: [{ recipe_id: 'mix-1', revision_id: 'rev-1', title: 'Evening mix', target_device_id: 'studio-1', verified_tracks: 5, total_tracks: 8, status: 'missing', last_verified_at: fresh() }],
  playback_owner: { device_id: 'studio-1', output_name: 'Speakers', status: 'playing' },
  local_storage: [{ device_id: 'studio-1', used_bytes: 10000000, free_bytes: 22000000, cache_bytes: 1000000 }],
});
function apiFor(result: unknown = snapshot()) {
  return vi.fn(async (path: string) => {
    if (path === '/local-first/personal/snapshot') return result;
    throw new Error(`unexpected request ${path}`);
  }) as unknown as Api;
}
const noop = vi.fn();

beforeEach(() => { localStorage.clear(); noop.mockReset(); });
afterEach(() => { cleanup(); });

describe('LF10 personal workspace', () => {
  it('shows verified readiness for the selected speaker and correct 5/8 per-device mix state', async () => {
    const account = cloudAccount();
    const api = apiFor();
    render(<DeviceHome account={account} api={api} workspaceId="ws-1" go={noop} />);
    expect(await screen.findByText('5 of 8 tracks verified')).toBeInTheDocument();
    expect(screen.getByText(/Recently verified on this device/)).toBeInTheDocument();
    expect(screen.queryByText(/Another device owns playback/)).not.toBeInTheDocument();
    expect(screen.getByText(/Evictable cache/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current speaker' })).toBeInTheDocument();
    expect(screen.getByText(/Saved recipes are editable even when/)).toBeInTheDocument();
  });
  it('makes controller-only selection explicit without pretending phone has its own audio', async () => {
    const account = cloudAccount();
    render(<DeviceHome account={account} api={apiFor()} workspaceId="ws-1" go={noop} />);
    const picker = await screen.findByRole('combobox', { name: 'Selected music device' });
    await userEvent.selectOptions(picker, '__controller_only__');
    expect(screen.getByText(/This browser cannot play music from another computer/)).toBeInTheDocument();
    expect(localStorage.getItem('selecta:lf10:selected-device:ws-1')).toBe('__controller_only__');
  });
  it('explains a disconnected drive, incomplete analysis and unsupported files without paths', async () => {
    const api = apiFor();
    render(<DeviceLibrary api={api} workspaceId="ws-1" go={noop} />);
    expect(await screen.findByText(/Drive disconnected/)).toBeInTheDocument();
    expect(screen.getByText('Analysis: 5 of 8')).toBeInTheDocument();
    expect(screen.getByText(/1 unsupported files/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add local source' })).toBeInTheDocument();
  });
  it('provides a local source chooser rather than a cloud upload form', async () => {
    const api = apiFor();
    render(<ConnectLocalMusic api={api} workspaceId="ws-1" go={noop} />);
    expect(await screen.findByRole('heading', { name: 'Set up your music' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start upload/ })).toBeNull();
    expect(screen.queryByLabelText(/Choose music files/)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Pair an existing speaker' }));
    expect(screen.getByRole('textbox', { name: 'Speaker pairing code' })).toBeInTheDocument();
    expect(screen.getByText(/Pairing shares control, not its music files/)).toBeInTheDocument();
  });
  it('recovers from absent backend endpoints, without treating a failed check as an empty library', async () => {
    const api = vi.fn(async () => { throw new CloudError('No such route', 404); }) as unknown as Api;
    render(<DeviceLibrary api={api} workspaceId="ws-1" go={noop} />);
    expect(await screen.findByText(/Device management has not been enabled/)).toBeInTheDocument();
    expect(screen.getByText(/Source inventory is unknown/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check devices again' })).toBeInTheDocument();
    expect(screen.queryByText(/Your library is empty/)).toBeNull();
  });
  it('does not call any hosted upload/asset endpoint when device-first mode is selected', async () => {
    const api = apiFor();
    render(<DeviceLibrary api={api} workspaceId="ws-1" go={noop} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Selected music device' })).toBeInTheDocument());
    const requests = (api as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(requests).toEqual(['/local-first/personal/snapshot']);
  });
});
