# LF versioned API, device and recipe contracts

**Status:** Accepted design, schematic only; no API routes or schemas implemented. **Owners:** 0456-0462,0466,0469,0483. Existing cloud endpoints and clients remain live until migration.

## Runtime and capability handshake

A local engine registers a scoped device identity through an outbound authenticated connection; controllers communicate with cloud and never directly receive media. The server replies with allowed workspace and zone scope, policy generation, protocol version and bounded offline entitlements. Agent reports an allowlisted capability document: engine build/version, features, supported codecs, stable output identifiers, platform, resource capabilities, last actual playback sample, local catalogue version and cache freshness. Do not transmit raw filesystem paths, global audio hashes, fingerprint templates, PCM or derived audio.

Suggested logical models (not final API shape):

```json
{
  "device_id": "device_opaque",
  "workspace_id": "workspace_opaque",
  "protocol_version": 1,
  "audio_executor": "local_engine",
  "connectivity": "online",
  "engine_version": "semantic-version",
  "capabilities": {"analyse": true, "seams": true, "stems": false, "outputs": 1},
  "observed_at": "device-reported-timestamp",
  "last_confirmed_server_at": "server-timestamp"
}
```

## Recipe contract

```json
{
  "recipe_id": "opaque-mix-id",
  "revision_id": "immutable-revision",
  "parent_revision": "previous-revision-or-null",
  "schema_version": 2,
  "occurrences": [
    {"occurrence_id": "occ-1", "canonical_track_id": "track-opaque-a"},
    {"occurrence_id": "occ-2", "canonical_track_id": "track-opaque-b"}
  ],
  "seams": [
    {"from_occurrence_id": "occ-1", "to_occurrence_id": "occ-2",
     "type": "beatmatched_crossfade", "duration_seconds": 12}
  ]
}
```

Cloud schema stores no media bytes or local path; a canonical track need not be present on any currently online device. Real recipes also require validated timing reference, optional policy and engine compatibility constraints, stable schema migration, and bounded fields.

## Availability response contract

Availability is per `(workspace, target device, recipe revision, policy version)`, with a server-confirmed freshness bound; never a global boolean:

```json
{
  "target_device_id": "device_opaque",
  "recipe_revision": "immutable-revision",
  "status": "needs_attention",
  "last_verified_at": "timestamp",
  "tracks": [
    {"occurrence_id": "occ-1", "state": "ready", "reason": null},
    {"occurrence_id": "occ-2", "state": "version_mismatch", "reason": "different_recording"}
  ],
  "transition_states": [{"index": 0, "state": "requires_local_rebuild"}]
}
```

No path, fingerprint or media hash in cloud response. Candidate matches cannot be silently promoted to Ready. Clients use stable refusal codes from [UI matrix](selecta-local-first-ui-state-matrix.md).

## Commands and acknowledgements

```json
{
  "operation_id": "idempotent-uuid",
  "workspace_id": "workspace_opaque",
  "zone_id": "optional-zone",
  "target_device_id": "device_opaque",
  "expected_generation": 23,
  "expected_recipe_revision": "immutable-revision",
  "command": "skip",
  "arguments": {},
  "created_at": "server-timestamp",
  "expires_at": "server-timestamp"
}
```

Lifecycle: `created -> authorised -> queued -> delivered -> accepted -> applied -> acknowledged`; terminals `rejected|expired|superseded|conflicted|failed`. After a timeout, state is **Unknown** until agent reconciliation; never assume the command ran or retry unboundedly. Stale transport commands are not replayed after long offline periods. Local engine independently checks actor scope, policy, speaker generation and output health.

## Speaker takeover protocol

1. Authenticate target and read fresh local media/output readiness.
2. Prepare current song and imminent transitions on destination without output.
3. Create takeover operation, fence generations and request current speaker to stop/fade.
4. Require release or documented safe isolation; if original is partitioned and may still output audio, refuse normal takeover.
5. Grant and confirm new speaker; start locally and publish authoritative ACK.
6. Detect crash between steps and recover deterministically; source keeps playing if preflight failed.

## Offline journal

Durable local outbox events include unique ID, device generation, zone, local sequence, event type, original time and server receipt ordering. Sync only approved metadata/play-log data with dedupe and tenant checks. Server is authoritative for billing, rights and policy version; local device for audio output and actual playback. Resolution after restored DB backup must not replay Skip/Play instructions or duplicate log entries.

## Security guardrails

Typed allowlist; bounded messages; no arbitrary filesystem path or shell/process commands; no generated storage URLs; no debug media attachments; no cross-tenant device discovery. JWT session for user control and separately scoped device credentials. Pairing, rotation, re-auth and revocation are explicit flows; CORS is not authentication. Version compatibility and idempotency maintained during rollout.
