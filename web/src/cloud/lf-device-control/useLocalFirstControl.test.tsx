// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api';
import type { LocalControlAdapter } from './adapter';
import { LocalFirstPlayer } from './LocalFirstPlayer';
import { useLocalFirstControl } from './useLocalFirstControl';
import { useCloudPlayer } from '../useCloudPlayer';
import type { DeviceReadiness, LocalDevice, LocalSession } from './contracts';

const time = () => new Date().toISOString();
const engine = (): LocalDevice => ({
  device_id: 'pc', name: 'Studio PC', this_device: true, role: 'local_engine',
  connectivity: 'online', last_confirmed_server_at: time(),
  outputs: [{ id: 'dac', name: 'USB speakers', health: 'ready' }],
});
const oldSpeaker = (): LocalDevice => ({
  ...engine(), device_id: 'old', name: 'Living room PC', this_device: false,
  outputs: [{ id: 'old-output', name: 'Main speakers', health: 'ready' }],
});
const sample = (): LocalSession => ({
  workspace_id: 'ws', speaker_device_id: 'old', speaker_name: 'Living room PC',
  output_id: 'old-output', output_name: 'Main speakers', generation: 23,
  recipe_revision: 'revision-5', observed_at: time(), output_state: 'audible',
  state: 'playing', original_can_be_fenced: true,
});
const report = (): DeviceReadiness => ({
  target_device_id: 'pc', recipe_revision: 'revision-5',
  output_id: 'dac', last_verified_at: time(), status: 'ready',
  tracks: [{ occurrence_id: 'a', state: 'ready', reason: null }],
  transition_states: [{ index: 0, state: 'ready' }],
});
const api: Api = (async () => { throw new Error('No real API in isolated client tests'); }) as Api;

function fixture(opts: { local?: LocalDevice; now?: LocalSession; ready?: DeviceReadiness; safe?: boolean } = {}) {
  let current = opts.now === undefined ? sample() : opts.now;
  const devices = opts.local === undefined ? [engine(), oldSpeaker()] : [opts.local, oldSpeaker()];
  const availability = vi.fn(async () => opts.ready ?? report());
  const preflight = vi.fn(async () => ({
    preflight_id: 'prepared-1', expires_at: new Date(Date.now() + 30_000).toISOString(),
    safe: opts.safe ?? true, reason: opts.safe === false ? 'USB output unavailable' : null,
    target_device_id: 'pc', expected_generation: 23,
    recipe_revision: 'revision-5', output_id: 'dac',
  }));
  const submit = vi.fn(async (command: { operation_id: string }) => ({
    operation_id: command.operation_id, state: 'queued' as const,
    applied_generation: null, reason: null,
  }));
  const operation = vi.fn(async (id: string) => ({
    operation_id: id, state: 'queued' as const,
    applied_generation: null, reason: null,
  }));
  const adapter: LocalControlAdapter = {
    listDevices: vi.fn(async () => devices),
    session: vi.fn(async () => current),
    availability, preflight, submit, operation,
  };
  return { adapter, availability, preflight, submit, operation, setSession: (next: LocalSession) => { current = next; } };
}
const hook = (adapter: LocalControlAdapter) =>
  renderHook(() => useLocalFirstControl({ api, workspaceId: 'ws', actorId: 'user-1', adapter }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LF12 safety-critical device operations', () => {
  it('rejects a controller-only phone even when another speaker has music', async () => {
    const f = fixture({ local: { ...engine(), device_id: 'phone', name: 'Phone', role: 'controller_only', outputs: [] } });
    const view = hook(f.adapter);
    await waitFor(() => expect(view.result.current.here?.role).toBe('controller_only'));
    await act(async () => { await view.result.current.takeOver(); });
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    view.unmount();
  });

  it('preserves the old speaker when one of two recordings is missing', async () => {
    const bad: DeviceReadiness = { ...report(), status: 'needs_attention', tracks: [
      report().tracks[0], { occurrence_id: 'b', state: 'missing', reason: 'drive unplugged' },
    ] };
    const f = fixture({ ready: bad });
    const view = hook(f.adapter);
    await waitFor(() => expect(view.result.current.here?.device_id).toBe('pc'));
    await waitFor(() => expect(view.result.current.outputId).toBe('dac'));
    await act(async () => { await view.result.current.takeOver(); });
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(view.result.current.notice).toContain('1 local recordings');
    view.unmount();
  });

  it('refuses a partitioned old speaker even when new media is verified', async () => {
    const f = fixture({ now: { ...sample(), original_can_be_fenced: false } });
    const view = hook(f.adapter);
    await waitFor(() => expect(view.result.current.outputId).toBe('dac'));
    await act(async () => { await view.result.current.takeOver(); });
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(view.result.current.notice).toContain('Unsafe takeover');
    view.unmount();
  });

  it('never submits command if destination output preparation fails', async () => {
    const f = fixture({ safe: false });
    const view = hook(f.adapter);
    await waitFor(() => expect(view.result.current.outputId).toBe('dac'));
    await act(async () => { await view.result.current.takeOver(); });
    expect(f.preflight).toHaveBeenCalledOnce();
    expect(f.submit).not.toHaveBeenCalled();
    expect(view.result.current.notice).toContain('USB output unavailable');
    view.unmount();
  });

  it('keeps a queued takeover pending until actual engine output is confirmed', async () => {
    const f = fixture();
    const view = hook(f.adapter);
    await waitFor(() => expect(view.result.current.outputId).toBe('dac'));
    await act(async () => { await view.result.current.takeOver(); });
    await waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
    expect(view.result.current.pending?.stage).toBe('queued');
    const command = f.submit.mock.calls[0][0];
    expect(command).toMatchObject({
      workspace_id: 'ws', actor: { kind: 'user', id: 'user-1' },
      expected_generation: 23, expected_recipe_revision: 'revision-5',
      command: 'takeover', target_device_id: 'pc',
      arguments: { output_id: 'dac', preflight_id: 'prepared-1' },
    });
    expect(view.result.current.pending?.stage).not.toBe('applied');
    view.unmount();
  });

  it('remote play is a metadata command, not an audio element or an R2 fetch', async () => {
    const f = fixture();
    render(<LocalFirstPlayer api={api} workspaceId="ws" actorId="user-1" adapter={f.adapter} />);
    await screen.findByText(/Playing on Living room PC/);
    expect(document.querySelector('audio')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Control Existing Speaker' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause speaker' }));
    await waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
    expect(f.submit.mock.calls[0][0]).toMatchObject({ command: 'pause', target_device_id: 'old' });
    expect(screen.getByTestId('lf12-command')).toHaveTextContent('queued');
    expect(document.querySelector('audio')).toBeNull();
  });

  it('announces stale output telemetry and avoids unsafe Play Here', async () => {
    const stale = { ...sample(), observed_at: new Date(Date.now() - 120_000).toISOString() };
    const f = fixture({ now: stale });
    render(<LocalFirstPlayer api={api} workspaceId="ws" actorId="user-1" adapter={f.adapter} />);
    await screen.findByTestId('lf12-actual-speaker');
    await waitFor(() => expect(screen.getByTestId('lf12-actual-speaker')).toHaveTextContent('current sound unverified'));
    expect(screen.getByTestId('lf12-actual-speaker').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Control Existing Speaker' })).toBeDisabled();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('prevents legacy browser player from using playback proxies in local-first mode', async () => {
    const fetcher = vi.fn(async () => { throw new Error('R2 fetch forbidden'); });
    const request = vi.fn(async () => { throw new Error('Cloud media forbidden'); }) as unknown as Api;
    const player = renderHook(() => useCloudPlayer({
      api: request, workspaceId: 'ws', audio: { current: null }, setError: () => {},
      fetchImpl: fetcher as unknown as typeof fetch, localFirstMode: true,
    }));
    await act(async () => {
      await player.result.current.start([{
        id: 'asset-1', name: 'Fake recording', size: 10, sha256: null, format: null,
        duration_seconds: null, sample_rate: null, channels: null, created_at: 0,
      }], 0);
      await player.result.current.prefetchNext();
      await player.result.current.refreshUrl();
    });
    expect(player.result.current.track).toBeNull();
    expect(player.result.current.autoplay).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    player.unmount();
  });
});
