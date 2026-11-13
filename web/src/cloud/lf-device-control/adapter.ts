import type { Api } from '../api';
import type { CommandReceipt, DeviceReadiness, LocalCommand, LocalDevice, LocalSession, Preflight } from './contracts';

/**
 * Single swappable HTTP seam with Agent 07/08/03. The ADR API contract is schematic, so these
 * /lf/v1 endpoints are proposed integration routes, NOT claims that the server already supports
 * them. All requests carry workspace scope through Api; no browser media URLs are requested.
 */
export interface LocalControlAdapter {
  listDevices(): Promise<LocalDevice[]>;
  session(): Promise<LocalSession | null>;
  availability(deviceId: string, revision: string, outputId: string): Promise<DeviceReadiness>;
  preflight(deviceId: string, revision: string, outputId: string, generation: number): Promise<Preflight>;
  submit(command: LocalCommand): Promise<CommandReceipt>;
  operation(id: string): Promise<CommandReceipt>;
}

const apiRoot = '/lf/v1';
const encoded = encodeURIComponent;

export function httpLocalControl(api: Api, workspaceId: string): LocalControlAdapter {
  return {
    async listDevices() {
      const data = await api<{ devices: LocalDevice[] }>(`${apiRoot}/devices`, {}, workspaceId);
      return data.devices;
    },
    async session() {
      const data = await api<{ session: LocalSession | null }>(`${apiRoot}/playback/session`, {}, workspaceId);
      return data.session;
    },
    availability(deviceId, revision, outputId) {
      return api<DeviceReadiness>(
        `${apiRoot}/availability?target_device_id=${encoded(deviceId)}&recipe_revision=${encoded(revision)}&output_id=${encoded(outputId)}`,
        {}, workspaceId,
      );
    },
    preflight(deviceId, revision, outputId, generation) {
      return api<Preflight>(`${apiRoot}/playback/preflight`, {
        method: 'POST',
        body: JSON.stringify({ target_device_id: deviceId, recipe_revision: revision, output_id: outputId, expected_generation: generation }),
      }, workspaceId);
    },
    submit(command) {
      return api<CommandReceipt>(`${apiRoot}/control/commands`, {
        method: 'POST',
        headers: { 'Idempotency-Key': command.idempotency_key },
        body: JSON.stringify(command),
      }, workspaceId);
    },
    operation(id) {
      return api<CommandReceipt>(`${apiRoot}/control/operations/${encoded(id)}`, {}, workspaceId);
    },
  };
}
