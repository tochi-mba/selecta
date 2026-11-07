# Selecta 3.0: API contracts and compatibility

Covers S3-0071-01 to S3-0071-05, S3-0071-08, S3-0065-01, S3-0065-02 and S3-0076-04.

## The rule

The backend stays authoritative. Pages get what they need through `api.ts` and `state/readiness.ts`, and no page decides a status from a single field. Everything added here is additive: no route was removed or reinterpreted, there is no schema change, and no audio or planning algorithm changed.

## What was added

| Addition | Why it couldn't be done with what existed | If it's missing (older server) |
|---|---|---|
| `GET /api/folders/check?path=` | The page had no way to say why a folder wouldn't work before reading it | The page falls back to trying the scan |
| `POST /api/scan/cancel` | A scan couldn't be stopped | The Stop button isn't offered |
| `POST /api/drafts/restore?id=N` | Restore only knew the last deleted draft, so Undo could bring back the wrong one | `id` is ignored, as before |
| `POST /api/exports/jobs`, `GET /api/exports/jobs`, `GET /api/exports/jobs/{id}`, `DELETE /api/exports/jobs/{id}` | A blocking request lost its result if the panel closed or the page reloaded, and nothing tied a file to what it was made from | The panel says restarting Selecta is needed |
| `recent_operations` in `/api/diagnostics` | Operation ids reached the server, but nothing recorded what happened to them | Absent |
| HTML fallback for unknown addresses opened in a browser | An old link gave a bare JSON 404 | Same as before |

Stored additions: a preference key, `deleted_drafts`, with `last_deleted_draft` still written for older code. Job sidecars live in `exports/jobs/`. Both are ignored by older code.

`/api/status` reports these under `api.features`, including `folder_check`, `scan_cancel`, `draft_restore_by_id` and `export_jobs`.

## Every call the frontend makes

Reads, all retry-safe, with stale answers ignored by the caller: `/status`, `/mix`, `/mix/suggest`, `/mix/{n}/options`, `/drafts`, `/vibes`, `/songs`, `/songs/{id}`, `/library`, `/links`, `/discoveries`, `/seams/{key}`, `/requests`, `/jobs`, `/storage`, `/folders`, `/folders/check`, `/memory`, `/diagnostics`, `/listening`, `/exports/jobs`.

## How each kind of write stays safe

| Write | Identity | Stale guard | Retry after a lost reply |
|---|---|---|---|
| `POST /mix/songs`, `/mix/move`, `DELETE /mix/songs/{n}`, `/mix/{n}/lock`, `/mix/{n}/seam`, `/mix/{n}/render`, `/mix/{n}/studio/use`, `/mix/{n}/swap` | Scope from `?draft=`, position | `x-mix-order` gets 409 `mix_changed` | Refused, because the first one changed the order, and the page re-reads |
| `POST /mix/undo` | Scope | `x-mix-order` of the state it was offered for, and newest-only in Activity | Refused the same way |
| `POST /mix/pair` | Songs and scope | Both songs or neither | Could add twice. The response updates the page first, and the person sees it |
| `POST /requests` | Song, with `x-operation-id` | The server refuses a duplicate song | Answered once |
| `POST /requests/{id}/bridge` | Request id and exact route | The server re-checks the route | Same answer, because it's a stored choice |
| `POST /requests/insert` | Offer key, with `x-operation-id`, and order and playhead re-checked | Server refuses if order or playhead moved | Answered once |
| `DELETE /requests/{id}` | Request id | Reports `cancelled: false` if it already joined | Safe |
| `POST /listening/{id}/response` | Trial, with `x-operation-id` | | Answered once |
| `POST /discoveries/{id}/review` | Match id, with `x-operation-id` | | Answered once |
| `POST /drafts`, `/drafts/{id}/duplicate` | | | Can make a second draft, which is visible and deletable, so nothing is lost |
| `DELETE /drafts/{id}` | Draft id | 404 if already gone | Safe |
| `POST /drafts/restore?id=N` | Draft id | 404 if it can't | Safe |
| `POST /drafts/{id}/play` | Draft id | 404 if gone | Undoable |
| `POST /exports/jobs` | New job, with `x-mix-order` | 409 if the mix changed | Second job is visible, and neither touches the mix |
| `DELETE /exports/jobs/{id}` | Job id | Only while it can be cancelled | Safe |
| `POST /songs/{id}/correct`, `/never`, `/priority` | Song id | Values validated | Sets a value, so repeating is harmless |
| `POST /steer`, `POST /storage` | One setting | Newest press wins on the page, and the page shows what was confirmed | Sets a value, so repeating is harmless |
| `POST /seams/{key}/rate` | Exact seam key | | Sets a value, so repeating is harmless |

Settings have no conflict check because they're single values on one machine, and the last confirmed value is what's shown. This is what's left of T0096, and it's deliberate.

## Fields that may be missing

An older server, or a mid-upgrade one, can leave these out. Pages must cope:

| Field | Where | What pages do |
|---|---|---|
| `counts.ready` | `/status` | "Checking your song readiness", never zero |
| `eta`, `eta.*` | `/status`, `/mix` | No estimate shown, nothing invented |
| `readiness` | `/library` | "State unknown", never ready |
| `seam.state.status` outside the known five | `/mix` | Treated as not ready |
| `steering.target_label` | `/status` | "Song N" |
| `studio` | `/mix/{n}/options` | Studio says it isn't supported here |
| `transitions`, `route` | `/requests` | Shown as "getting it ready", with no invented steps |

## Export: what it did, and what it does now

**Before (S3-0065-01).** `POST /api/mix/export` joined the live mix and blocked until the file existed. Files live in `exports/` under the Selecta home, kept until someone deletes them, with no record of what they came from. Closing the panel lost the link, and reloading lost everything. The route still exists and behaves the same.

**Now (S3-0065-02).** A job snapshots, at the moment of asking:

```
id, created_at, scope (current or draft), draft id, mix name
songs: ordered [{id, title, artist}]
seams: ordered [{key, settings}]
state: preparing | encoding | ready | failed | cancelling | cancelled | interrupted | expired
seams_ready, seams_total, quiet_seconds, name, seconds, error, can_cancel
```

- **Revision identity:** song order and seam keys. A seam's key is derived from the pair and its settings, so it names exact audio.
- **Immutable:** encoding reads the snapshot, not the live mix, so reordering or replacing the mix during a job can't change the file.
- **Failure:** if a snapshot seam fails, the job fails with the reason. It never substitutes something else, and retrying is a new job, from the mix as it is by then.
- **Retention:** as long as the file stays in `exports/`. A file that's gone reports `expired`, and no link is offered. Selecta doesn't delete exports.
- **Restart:** a job the server lost by restarting reads `interrupted`, never ready.

## Why no native folder picker

See [the privacy doc](selecta-3-privacy.md). This is the folder half of S3-0071-04.

## Compatibility and going back

Old identifiers and addresses are unchanged. `ADR-0071`'s rule that a CSS change can't change a schema is met trivially: this work made no schema change at all. See [routes](selecta-3-routes.md) for the kill switch. Tests prove old fixtures with missing fields, unknown enum values and refused stale writes behave as above.
