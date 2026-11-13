# Connected Cloud folder watches — local-only integration

## User-facing behaviour

The Cloud **Library** and **Add music** pages now provide **Manage folder watches**
alongside existing hosted uploads for *legacy* workspaces. This does not migrate
the user's recordings or delete old cloud assets. The opt-in local-first source
views show the manager directly.

The local development companion supports:

- Multiple independent watched folders and removable drives with persisted
  opaque source IDs and per-source scan state, counts and timestamps.
- Full-path validation and duplicate / nested-root warnings **before** adding a
  source. Subfolders are included; there is no redundant child watch.
- Background incremental scans on the **local development machine** about every
  five minutes, plus explicit per-folder **Scan now** requests.
- Pause, resume and **Stop watching** (confirmation required). Stop removes
  only the watch registration. Local files, prior indexed recording rows and
  hosted assets are never deleted by these operations.
- A disconnected or inaccessible drive is reported as unavailable; previous
  records are not silently marked deleted. Errors and stale counts remain
  visible, and the user can retry when their device recovers.
- Responsive source cards, search, attention filters, persistent notices,
  keyboard-focus styling and reduced-motion/forced-colour support.

The local source index is a separate catalogue. **It does not silently add songs
to the legacy hosted Cloud library or enable playback on another device.**
Existing uploads and older plans work unchanged.

## Architecture and security

Only `selecta.devstack.cloud_app` installs the new
`selecta.devstack.local_watches` router. `api_cloud.create_cloud_app` (hosted
Cloud) does **not** install it. The data stays under the local development
folder in `local-watches.sqlite`; there is no audio proxy, object-store upload,
file serving or cloud-sync of paths and raw fingerprints.

Vite's Cloud dev configuration proxies **/dev/local-watches** to the
loopback-only dev API. The existing `LoopbackOnly` guard limits client and Host
to this computer; the router additionally requires an explicit custom header
and refuses unrelated browser origins. Production workspaces do not receive
this route. The path fields in its local response are for the **same-machine
development UI only**, never the approved metadata-only Cloud snapshot.

A remotely hosted Cloud browser cannot use its own filesystem paths to manage
a remote speaker. It presents a truthful device hand-off to the authorised
local engine. The existing `local_first.personal` snapshot independently
renders approved per-device source labels and readiness with opaque IDs.
Production source registration must be authorised through the engine's local
folder picker, and must then report only allowlisted metadata through the
device-to-cloud channel. The integration is **not** a new remote-path command.

## Development-only endpoint table

| Method | Local development route | Meaning |
| --- | --- | --- |
| GET | `/dev/local-watches` | Private same-machine source list / progress |
| GET | `/dev/local-watches/check?folder=...` | Local-only validation without changes |
| POST | `/dev/local-watches` | Register a folder after explicit user action |
| POST | `/dev/local-watches/{id}/scan` | Queue a local scan, not assert completion |
| PATCH | `/dev/local-watches/{id}` | Pause or resume watching |
| DELETE | `/dev/local-watches/{id}` | Forget watch registration, preserve media |

The route rejects unchecked origins, and it never accepts filesystem paths from
Cloud control envelopes. Only explicitly supplied **local** full paths are
inspected. The scan cursor, recording identities and analysis remain on the
computer.

## Validation

```sh
uv run pytest -q tests/test_cloud_dev_local_watches.py
cd web
pnpm exec vitest run src/cloud/lf-personal/FolderWatches.test.tsx
pnpm build
```

Manual smoke: `dev.cmd cloud` → **Add music** → **Manage folder watches**;
add two folders, add a new synthetic recording to one, scan, pause/resume,
disconnect/reconnect an external drive, stop watching with confirmation, and
confirm that local files were not deleted. Confirm legacy uploads still work,
and that a hosted origin never exposes the local dev routes.

## Production readiness

The UI/dev companion is useful for local Cloud development and preserves legacy
plan behaviour, but **it is not the completed production device/source control
bridge**. Agent LF01/LF03/LF07 integration still needs verified installer,
real engine source picker, outbound-authenticated per-device metadata sync,
role/policy checks and production multi-device browser E2E before rollout.
