import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  BrowserControlError,
  BrowserSessionClient,
  verifyDeliveredCommand,
  type BrowserEnvelope,
  type DeliveredCommand,
  type RegisteredSession,
} from "./client";

const NOW = 1_800_000_000;
const COMMAND: BrowserEnvelope = {
  schema_version: 1,
  operation_id: "op1",
  actor_id: "staff",
  actor_role: "staff",
  workspace_id: "w1",
  zone_id: "z1",
  session_id: "sid1",
  target_device_id: "ipad",
  expected_generation: 1,
  expected_recipe_revision: null,
  policy_version: 1,
  sequence: 1,
  action: "pause",
  arguments: {},
  created_at: NOW,
  expires_at: NOW + 30,
  idempotency_key: "key1",
};
const SESSION: RegisteredSession = {
  schema_version: 1,
  session_id: "sid1",
  session_token: "token-for-testing-not-a-real-session",
  command_key: "a".repeat(64),
  expires_at: NOW + 3600,
  device_id: "ipad",
  workspace_id: "w1",
  zone_id: "z1",
};
const SIGNATURE = "f3b18f7e63028ddc959115b92b13c8fd94c0c7040cebb641cd772964ff0e43a3";

describe("browser Cloud signed command contract", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (previous) Object.defineProperty(globalThis, "crypto", previous);
  });

  it("agrees with the exact Python HMAC canonical JSON and Unix-second format", async () => {
    const packet: DeliveredCommand = {
      schema_version: 1,
      command: COMMAND,
      signature: SIGNATURE,
    };
    await expect(verifyDeliveredCommand(packet, SESSION, NOW)).resolves.toEqual(COMMAND);
    await expect(verifyDeliveredCommand(packet, SESSION, NOW + 31)).rejects.toThrow(
      BrowserControlError,
    );
  });

  it("rejects forged signatures, cross-tenant targets and malicious extra fields", async () => {
    await expect(verifyDeliveredCommand({
      schema_version: 1, command: COMMAND, signature: "0".repeat(64),
    }, SESSION, NOW)).rejects.toThrow("bad_signature");
    await expect(verifyDeliveredCommand({
      schema_version: 1, command: COMMAND, signature: SIGNATURE,
    }, { ...SESSION, workspace_id: "w2" }, NOW)).rejects.toThrow("invalid_or_expired_command");
    await expect(verifyDeliveredCommand({
      schema_version: 1, command: { ...COMMAND, local_path: "/private/audio.mp3" } as BrowserEnvelope,
      signature: SIGNATURE,
    }, SESSION, NOW)).rejects.toThrow("invalid_envelope_fields");
  });

  it("does not auto-ack a received command or include any local audio", async () => {
    const requests: Array<{ path: string; method?: string; body?: string }> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      requests.push({ path, method: init?.method, body: init?.body?.toString() });
      let payload: object = {};
      if (path.endsWith("/devices")) payload = SESSION;
      else if (path.endsWith("/commands/next")) payload = {
        schema_version: 1, command: COMMAND, signature: SIGNATURE,
      };
      else if (path.endsWith("/recovery")) payload = {
        schema_version: 1, session_id: "sid1", online: true, generation: 1,
        last_issued_sequence: 1, outstanding: [{ operation_id: "op1", state: "delivered" }],
        replay_is_unsafe: true,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new BrowserSessionClient(async () => "user-access-token", fetcher);
    await client.register({
      device_id: "ipad", zone_id: "z1", label: "iPad",
      capabilities: {
        audio_worklet: true, wasm: true, webgpu: false, mobile: true,
        can_play: true, can_render: true,
      },
      browser_version: "safari17", dsp_version: "browser1",
    });
    // Client reads a signed command but never applies it or sends an ACK itself.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW * 1000));
    expect((await client.next())?.action).toBe("pause");
    expect(requests.some((r) => r.path.endsWith("/ack"))).toBe(false);
    const recovery = await client.recovery();
    expect(recovery.replay_is_unsafe).toBe(true);
    expect(JSON.stringify(requests)).not.toMatch(/local_path|pcm|stems|audio_bytes/);
    vi.useRealTimers();
  });
});
