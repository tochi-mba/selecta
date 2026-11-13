import React from 'react';
import { createRoot } from 'react-dom/client';
import type { LocalControlAdapter } from './adapter';
import type { CommandReceipt, DeviceReadiness, LocalCommand, LocalDevice, LocalSession } from './contracts';
import { LocalFirstPlayer } from './LocalFirstPlayer';

// Test-only in-memory local engines; this file is not imported by production routes.
const stamp = () => new Date().toISOString();
const local: LocalDevice = {
  device_id: 'pc', name: 'Studio PC', this_device: true, role: 'local_engine',
  connectivity: 'online', last_confirmed_server_at: stamp(),
  outputs: [{ id: 'dac', name: 'USB DAC', health: 'ready' }],
};
const old: LocalDevice = {
  device_id: 'old', name: 'Old speaker', this_device: false, role: 'local_engine',
  connectivity: 'online', last_confirmed_server_at: stamp(),
  outputs: [
    { id: 'main', name: 'Main speakers', health: 'ready' },
    { id: 'alternate', name: 'Alternate output', health: 'ready' },
  ],
};
type Fixture = {
  devices: LocalDevice[];
  session: LocalSession;
  availabilityState: DeviceReadiness['tracks'];
  transitionReady: boolean;
  preflightSafe: boolean;
  ack: CommandReceipt['state'];
  commands: LocalCommand[];
  preflights: number;
  slowAckMs: number;
};
declare global { interface Window { lf12?: Fixture; } }
const harness: Fixture = {
  devices: [local, old],
  session: {
    workspace_id: 'ws', speaker_device_id: 'old', speaker_name: 'Old speaker',
    output_id: 'main', output_name: 'Main speakers', generation: 23,
    recipe_revision: 'recipe-1', state: 'playing', output_state: 'audible',
    observed_at: stamp(), original_can_be_fenced: true,
  },
  availabilityState: [{ occurrence_id: 'song-1', state: 'ready', reason: null }],
  transitionReady: true, preflightSafe: true, ack: 'queued',
  commands: [], preflights: 0, slowAckMs: 0,
};
window.lf12 = harness;
const adapter: LocalControlAdapter = {
  async listDevices() { return harness.devices; },
  async session() { return harness.session; },
  async availability(target_device_id, recipe_revision, output_id) {
    return {
      target_device_id, recipe_revision, output_id,
      status: harness.availabilityState.every((song) => song.state === 'ready') && harness.transitionReady ? 'ready' : 'needs_attention',
      last_verified_at: stamp(),
      tracks: harness.availabilityState,
      transition_states: [{ index: 0, state: harness.transitionReady ? 'ready' : 'requires_local_rebuild' }],
    };
  },
  async preflight(target_device_id, recipe_revision, output_id, expected_generation) {
    harness.preflights++;
    return {
      preflight_id: 'pf-' + harness.preflights,
      expires_at: new Date(Date.now() + 20_000).toISOString(),
      safe: harness.preflightSafe, reason: harness.preflightSafe ? null : 'Destination preparation failed',
      target_device_id, recipe_revision, output_id, expected_generation,
    };
  },
  async submit(command) {
    harness.commands.push(command);
    if (harness.slowAckMs) await new Promise((resolve) => setTimeout(resolve, harness.slowAckMs));
    return { operation_id: command.operation_id, state: harness.ack, reason: null, applied_generation: null };
  },
  async operation(operation_id) {
    return { operation_id, state: harness.ack, reason: null, applied_generation: null };
  },
};
const api = async <T,>(): Promise<T> => { throw new Error('No cloud API in LF12 fixture'); };
createRoot(document.getElementById('root')!).render(
  <LocalFirstPlayer api={api} workspaceId="ws" actorId="fixture-user" adapter={adapter} />,
);
