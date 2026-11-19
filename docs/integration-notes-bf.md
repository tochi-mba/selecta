# Browser-first integration notes

Notes one BF workstream leaves for the integrator or for the owner of a file it may not touch.

## ADR-0461 playback fencing (backend)

Owner area: `src/selecta/playback/**`, migration `bf0461fence01`, `tests/test_bf_playback_fencing.py`.

### Routes and flags

- No route was added or renamed. `POST /api/playback/commands/{command_id}/ack` is already
  listed under `devices.remote_control` in `src/selecta/flags/cloud.json`; no change needed.

### Contract changes other areas must pick up

- `tests/test_cloud_playback_session.py`, `test_pause_freezes_the_position_where_the_music_was`
  (line 389) asserts the exact COMMAND event payload. The payload now also carries the ADR-0461
  envelope, so that assertion must become:
  `{"device_id": laptop.id, "command": "pause", "args": {}, "seq": 2, "command_id": result.command_id, "fence": 1, "expires_at": result.expires_at}`
  (or compare the old four keys only).
- `POST /api/playback/commands` now answers 409 with `detail.code` `superseded_command` (fence
  moved since the press) or `expired_command` (TTL ran out), alongside the existing
  `stale_command`. The answer (200 and 409 detail) also carries `fence` and `expires_at`.
  `web/src/devices/usePlaybackDevice.ts` only special-cases `stale_command`; the other two should
  get the same "here's where it is now" treatment.
- `POST /api/playback/heartbeat` accepts an optional `fence`. The speaker should send the fence it
  last saw: a device claiming a lapsed lease with an older fence is refused (stale speaker
  resurrection). The current holder always renews and should adopt `session.fence` from the
  answer. `zone_session.zone_heartbeat` takes the same `fence` keyword for the zone routes.
- The speaker should ack each COMMAND event it handles at
  `POST /api/playback/commands/{command_id}/ack` with `result` `applied` or `unavailable_here`,
  after checking `fence` and `expires_at` from the event against its session and `server_time`.
  The recorded `ack_result` can come back `superseded` or `expired` (the server's verdict). Only
  the speaker may ack (403 `not_the_speaker`), only delivered commands (422), and a repeat
  replays the first answer.
- `session` payloads (events and every route) carry `fence` and `state_confidence`
  (`fresh` or `uncertain`, judged at server time).

### Deferred delivery, signing and programmes (BF-0461-01/04/05, BF-0457-03)

Migrations `bf0461defer01` and `bf0457output01` (chained after `bf0461fence01`).

- A speaker press (pause, skip, seek, volume, `set_programme`) for a speaker whose lease lapsed
  is no longer applied: it answers 200 `status: "deferred"` with a `message`, and is delivered
  or dropped (`expired`, `superseded`, `stale`) when the speaker next renews, reconnects, or
  someone takes over (`playback/deferred.py`). Play with an offline speaker stays `no_speaker`;
  mix commands still apply at once. Drops are published as `playback.missed` and returned as
  `missed` (and `delivered`) on heartbeat, reconnect and take-over answers.
- `GET /api/playback/session` carries `notices` (`missed`, `waiting`, `unavailable`, last 15
  minutes) and, for the speaker only, `envelope_key`. Heartbeat, take-over and reconnect
  answers carry `envelope_key` for the holder.
- `playback.command` events carry `issued_by`, `envelope` (canonical JSON) and `signature`
  (HMAC-SHA256 under the lease key). Set `SELECTA_PLAYBACK_SIGNING_SECRET` in production; the
  per-session salt alone keys the HMAC without it. Acks may echo `signature` (mismatch: 422
  `bad_signature`) and, for `unavailable_here`, `song_id`; the answer and the
  `playback.unavailable` event carry `alternatives`.
- Command args that look like audio, a URL or a path are refused 422 (`envelope.py`).
- Heartbeats accept `output_status` (`playing` with `output_verified_at`, `output_unverified`,
  `uncertain`, `interrupted`); session payloads show `output_status` / `output_verified_at`
  while that device holds the lease, `uncertain` once it lapses.
- Zone routes are not wired yet; `zone_session` passes `volume_cap` and `events` through the
  shared `*_in` functions, so a zone gets the same behaviour when they are.

## ADR-0456 / ADR-0464 / ADR-0465 hosted coexistence (backend)

The grandfather helpers live in `src/selecta/hosted_coexistence/` (renamed from the abandoned
`lf_migration`; nothing else imported it). The admin audit route
`GET /api/admin/flags/cloud.hosted_media/grandfather-audit` is already registered in
`src/selecta/flags/cloud.json` (admin console routes), so no `cloud.json` change is needed.

### Edits needed in `src/selecta/api_cloud.py` (not made here)

- `/api/account` (`get_account`, around line 547): the storage meter must consult the grant
  (BF-0456-06, BF-0464-02). Delete the line
  `usage = meters.meters(conn, principal.workspace.id, plan, principal.user.timezone)`
  and, inside the same `with transaction(...)` block directly after `decisions = targeting.decide_all(...)`, add:
  `hosted = decisions.snapshot().get("cloud.hosted_media") is not False`
  `usage = meters.meters(conn, principal.workspace.id, plan, principal.user.timezone, hosted_media_granted=hosted)`
  and in the returned `"experience"` block replace the `"hosted": ...` expression with `"hosted": hosted,`
  so the meter and the shell read one answer. This decides with the signed-in person's context
  (USERS exceptions and staff previews count), which is right for what that person sees.
- Any other `meters.meters(...)` or `quota.require_writable(...)` call that has no principal
  (maintenance, admin pages) should pass the concrete predicate instead:
  `from selecta.hosted_coexistence.grant import hosted_media_granted, hosted_media_predicate`,
  then `quota.require_writable(conn, workspace_id, hosted_media=hosted_media_predicate(rule_cache))`
  or `meters.meters(..., hosted_media_granted=hosted_media_granted(conn, workspace_id, rules=rule_cache))`.
  Today there are no such callers: `require_writable` has no call site anywhere in `src/`.

### Behaviour notes for other areas

- `flip_guard.check_flip` takes an optional `grandfather_missing` (the audit's missing ids) and
  refuses while it is non-empty; `check_flip_now` computes it from the database, so it must run
  in a system transaction (no workspace id), or row-level security hides other workspaces.
- The audit's `complete` means every workspace with a completed upload (soft-deleted assets
  included) answers on at the rules layer, evaluated in order (a grant below the catch-all or
  behind a kill switch is missing). Grants to workspaces outside the population are listed as
  `stale_grants` and do not fail the audit (ADR-0456 lets the owner grant accounts that never
  uploaded). The payload also gained `counts`, `deleted_assets` and `decided_by`.
- `quota.require_writable(hosted_media=...)` cannot change an outcome today: it only skips when
  nothing is stored or reserved, and a workspace with zero committed bytes is never over quota.
  The behaviour that users see is `storage_mode` in the meters, once the `/api/account` edit above lands.
