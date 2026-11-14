/** Browser-first metadata/control transport. Never accepts File, Blob, URL or audio buffers.
 *
 * Agent 01/08 must provide real media/output execution and separately confirm each
 * command. There is deliberately no automatic "applied" acknowledgement on receipt.
 * Tokens and HMAC keys live in memory; never put them into localStorage or URL params.
 */

import { apiOrigin } from "../api";

export type Role = "owner" | "admin" | "dj" | "staff" | "viewer";
export type OutputState = "unknown" | "silent" | "audible" | "operator_confirmed";
export type RuntimeState = "active" | "hidden" | "suspended" | "interrupted" | "closed";
export type CommandState =
  | "created" | "authorised" | "queued" | "delivered" | "accepted"
  | "applied" | "acknowledged" | "rejected" | "conflicted" | "superseded" | "expired";
export type Action =
  | "play" | "pause" | "skip" | "seek" | "set_volume" | "steer" | "reorder"
  | "approve_request" | "set_policy" | "set_schedule"
  | "prepare_output" | "release_output" | "activate_output";
export type Capabilities = {
  audio_worklet: boolean;
  wasm: boolean;
  webgpu: boolean;
  can_play: boolean;
  can_render: boolean;
  mobile: boolean;
};
export type BrowserEnvelope = Readonly<{
  schema_version: 1;
  operation_id: string;
  actor_id: string;
  actor_role: Role;
  workspace_id: string;
  zone_id: string;
  session_id: string;
  target_device_id: string;
  expected_generation: number;
  expected_recipe_revision: string | null;
  policy_version: number;
  sequence: number;
  action: Action;
  arguments: Record<string, string | number | boolean | string[]>;
  created_at: number;
  expires_at: number;
  idempotency_key: string;
}>;
export type Presence = Readonly<{
  foreground: boolean;
  runtime_state: RuntimeState;
  capabilities: Capabilities;
  source_ready: boolean;
  source_count: number;
  source_checked_at: number; // Unix epoch seconds, never ISO strings
  output_state: OutputState;
  output_checked_at: number;
  generation: number;
  policy_version: number;
  recipe_revision: string | null;
}>;
export type Registration = Readonly<{
  device_id: string;
  zone_id: string;
  label: string;
  capabilities: Capabilities;
  browser_version: string;
  dsp_version: string;
}>;
export type RegisteredSession = Readonly<{
  schema_version: 1;
  session_id: string;
  session_token: string;
  command_key: string;
  expires_at: number;
  device_id: string;
  workspace_id: string;
  zone_id: string;
}>;
export type CommandRequest = Readonly<{
  target_session_id: string;
  operation_id: string;
  idempotency_key: string;
  action: Exclude<Action, "prepare_output" | "release_output" | "activate_output">;
  arguments: BrowserEnvelope["arguments"];
  expected_generation: number;
  recipe_revision: string | null;
  policy_version: number;
}>;
export type TakeoverRequest = Readonly<{
  target_session_id: string;
  operation_id: string;
  idempotency_key: string;
  expected_generation: number;
  /** Privileged *on-site* proof for a never-provisioned zone only. */
  initial_silence_confirmed?: boolean;
}>;
export type AckEvidence = Readonly<{
  status: "accepted" | "applied" | "rejected" | "conflicted";
  fenced_generation: number;
  output_confirmed?: boolean;
  output_silent?: boolean;
  execution_verified?: boolean;
}>;
export type DeliveredCommand = Readonly<{
  schema_version: 1;
  command: BrowserEnvelope | null;
  signature?: string;
}>;
export type DeviceSummary = Readonly<{
  device_id: string;
  session_id: string;
  label: string;
  online: boolean;
  runtime_state: RuntimeState;
  foreground: boolean;
  capabilities: Capabilities;
  browser_version: string;
  dsp_version: string;
  source_ready: boolean;
  source_count: number;
  output_state: OutputState;
  generation: number;
}>;
export type Speaker = Readonly<{
  schema_version: 1;
  zone_id: string;
  generation: number;
  speaker_session_id: string | null;
  state: "unprovisioned" | "silent" | "audible" | "unknown";
  online?: boolean;
  pending_transfer?: string | null;
}>;
export type CommandReceipt = Readonly<{
  schema_version: 1;
  operation_id: string;
  state: CommandState;
  replayed?: boolean;
}>;
export type TransferReceipt = Readonly<{
  schema_version: 1;
  transfer_id: string;
  generation: number;
  stage: "preparing" | "awaiting_release" | "awaiting_activation" | "started" | "blocked";
  replayed?: boolean;
}>;

const IDENT = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/;
const ACTIONS: ReadonlySet<string> = new Set([
  "play", "pause", "skip", "seek", "set_volume", "steer", "reorder",
  "approve_request", "set_policy", "set_schedule",
  "prepare_output", "release_output", "activate_output",
]);
const FIELDS = [
  "schema_version", "operation_id", "actor_id", "actor_role", "workspace_id", "zone_id",
  "session_id", "target_device_id", "expected_generation", "expected_recipe_revision",
  "policy_version", "sequence", "action", "arguments", "created_at", "expires_at",
  "idempotency_key",
] as const;
const BASE = apiOrigin + "/api/lf/v1";

export class BrowserControlError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "BrowserControlError";
  }
}

function canonical(value: unknown): string {
  // Server uses Python json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=True).
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return "{" + entries.map(([key, child]) => JSON.stringify(key) + ":" + canonical(child)).join(",") + "}";
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new BrowserControlError(422, "unsafe_envelope");
  // Commands contain only ASCII identifiers/enum strings, ASCII keys and numbers.
  if (/[\u0080-\uffff]/.test(encoded)) throw new BrowserControlError(422, "non_ascii_envelope");
  return encoded;
}

export async function verifyDeliveredCommand(
  packet: DeliveredCommand,
  expected: Pick<RegisteredSession, "session_id" | "device_id" | "workspace_id" | "command_key">,
  nowSeconds = Date.now() / 1000,
): Promise<BrowserEnvelope | null> {
  if (packet.schema_version !== 1) throw new BrowserControlError(422, "unsupported_protocol");
  if (packet.command === null) return null;
  const cmd = packet.command as unknown as Record<string, unknown>;
  if (Object.keys(cmd).sort().join("|") !== [...FIELDS].sort().join("|")) {
    throw new BrowserControlError(422, "invalid_envelope_fields");
  }
  const envelope = packet.command;
  if (
    envelope.schema_version !== 1 || !IDENT.test(envelope.operation_id)
    || !IDENT.test(envelope.actor_id) || !IDENT.test(envelope.zone_id)
    || envelope.session_id !== expected.session_id
    || envelope.target_device_id !== expected.device_id
    || envelope.workspace_id !== expected.workspace_id
    || !ACTIONS.has(envelope.action)
    || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1
    || !Number.isSafeInteger(envelope.expected_generation)
    || envelope.expected_generation < 0
    || !Number.isFinite(envelope.created_at) || !Number.isFinite(envelope.expires_at)
    || envelope.created_at > nowSeconds + 30 || envelope.expires_at <= nowSeconds
    || typeof packet.signature !== "string" || !/^[a-f0-9]{64}$/.test(packet.signature)
  ) throw new BrowserControlError(422, "invalid_or_expired_command");
  if (!globalThis.crypto?.subtle) throw new BrowserControlError(503, "webcrypto_unavailable");
  const hmacKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(expected.command_key),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const signatureBytes = Uint8Array.from(
    packet.signature.match(/.{2}/g) ?? [], (hex) => Number.parseInt(hex, 16),
  );
  const valid = await crypto.subtle.verify(
    "HMAC", hmacKey, signatureBytes, new TextEncoder().encode(canonical(envelope)),
  );
  if (!valid) throw new BrowserControlError(403, "bad_signature");
  return envelope;
}

export type BrowserFetch = typeof fetch;

export class BrowserSessionClient {
  private credentials: RegisteredSession | null = null;
  private highestSequence = 0;

  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetcher: BrowserFetch = fetch,
    private readonly workspaceId?: string,
  ) {}

  get registered(): boolean { return this.credentials !== null; }
  get sessionId(): string | null { return this.credentials?.session_id ?? null; }

  private async request<T>(
    path: string, method: "GET" | "POST" = "GET", data?: object,
    sessionToken = false,
  ): Promise<T> {
    const bearer = await this.accessToken();
    if (!bearer) throw new BrowserControlError(401, "login_required");
    const headers: Record<string, string> = {
      Authorization: "Bearer " + bearer,
      Accept: "application/json",
      "Cache-Control": "no-store",
    };
    if (this.workspaceId) headers["X-Workspace-ID"] = this.workspaceId;
    if (sessionToken) {
      if (!this.credentials) throw new BrowserControlError(401, "session_required");
      headers["X-Selecta-Session-Token"] = this.credentials.session_token;
    }
    if (data) headers["Content-Type"] = "application/json";
    const response = await this.fetcher(BASE + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      cache: "no-store",
      credentials: "omit", // Don't accidentally add ambient cookie identity
      redirect: "error",
    });
    if (!response.ok) {
      let code = "control_request_failed";
      try {
        const payload = await response.json() as { detail?: string };
        if (typeof payload.detail === "string") code = payload.detail;
      } catch { /* Keep safe status only. */ }
      throw new BrowserControlError(response.status, code);
    }
    return await response.json() as T;
  }

  async register(body: Registration): Promise<void> {
    // Discard old session; no secret is written to browser persistence.
    const result = await this.request<RegisteredSession>("/devices", "POST", body);
    if (result.schema_version !== 1 || !IDENT.test(result.session_id)) {
      throw new BrowserControlError(422, "invalid_registration");
    }
    this.credentials = result;
    this.highestSequence = 0;
  }

  async refresh(): Promise<void> {
    if (!this.credentials) throw new BrowserControlError(401, "session_required");
    const updated = await this.request<Pick<RegisteredSession,
      "session_id" | "session_token" | "command_key" | "expires_at">>(
      "/sessions/" + this.credentials.session_id + "/refresh", "POST", {}, true,
    );
    this.credentials = { ...this.credentials, ...updated };
  }

  async presence(data: Presence): Promise<void> {
    if (!this.credentials) throw new BrowserControlError(401, "session_required");
    await this.request("/sessions/" + this.credentials.session_id + "/presence",
      "POST", data, true);
  }

  async revoke(): Promise<void> {
    if (!this.credentials) return;
    try {
      await this.request("/sessions/" + this.credentials.session_id + "/revoke",
        "POST", {}, true);
    } finally {
      this.credentials = null;
      this.highestSequence = 0;
    }
  }

  async recovery(): Promise<{
    schema_version: 1;
    session_id: string;
    online: boolean;
    generation: number;
    last_issued_sequence: number;
    outstanding: Array<{ operation_id: string; state: CommandState }>;
    replay_is_unsafe: boolean;
  }> {
    if (!this.credentials) throw new BrowserControlError(401, "session_required");
    return this.request(
      "/sessions/" + this.credentials.session_id + "/recovery", "GET", undefined, true,
    );
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.request("/devices/" + encodeURIComponent(deviceId) + "/revoke", "POST", {});
    if (this.credentials?.device_id === deviceId) this.credentials = null;
  }

  async devices(zone: string): Promise<DeviceSummary[]> {
    const result = await this.request<{ devices: DeviceSummary[] }>(
      "/zones/" + encodeURIComponent(zone) + "/devices");
    return result.devices;
  }

  async speaker(zone: string): Promise<Speaker> {
    return this.request("/zones/" + encodeURIComponent(zone) + "/speaker");
  }

  async command(zone: string, body: CommandRequest): Promise<CommandReceipt> {
    return this.request("/zones/" + encodeURIComponent(zone) + "/commands", "POST", body);
  }

  async takeover(zone: string, body: TakeoverRequest): Promise<TransferReceipt> {
    return this.request("/zones/" + encodeURIComponent(zone) + "/takeovers", "POST", body);
  }

  async next(): Promise<BrowserEnvelope | null> {
    if (!this.credentials) throw new BrowserControlError(401, "session_required");
    const packet = await this.request<DeliveredCommand>(
      "/sessions/" + this.credentials.session_id + "/commands/next", "GET",
      undefined, true,
    );
    const command = await verifyDeliveredCommand(packet, this.credentials);
    if (!command) return null;
    // Duplicate delivery must not cause a second Play/Skip. Recover by status lookup.
    if (command.sequence <= this.highestSequence) {
      throw new BrowserControlError(409, "stale_or_duplicate_sequence");
    }
    this.highestSequence = command.sequence;
    return command;
  }

  async ack(operationId: string, data: AckEvidence): Promise<CommandReceipt> {
    if (!this.credentials) throw new BrowserControlError(401, "session_required");
    if (!IDENT.test(operationId)) throw new BrowserControlError(422, "invalid_operation");
    return this.request(
      "/sessions/" + this.credentials.session_id + "/commands/"
      + encodeURIComponent(operationId) + "/ack",
      "POST", data, true,
    );
  }

  async operation(zone: string, operationId: string): Promise<CommandReceipt> {
    return this.request(
      "/zones/" + encodeURIComponent(zone) + "/commands/" + encodeURIComponent(operationId),
    );
  }

  async transfer(zone: string, transferId: string): Promise<TransferReceipt> {
    return this.request(
      "/zones/" + encodeURIComponent(zone) + "/takeovers/" + encodeURIComponent(transferId),
    );
  }
}
