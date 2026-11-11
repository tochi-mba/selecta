# Selecta - persisted state and API side-effect map (EX-0114-04)

This is the second half of the experience-first preservation map. [selecta-experience-feature-parity.md](selecta-experience-feature-parity.md) maps capabilities and [mp-0272-surface-inventory.json](mp-0272-surface-inventory.json) lists every route, tab, overlay and flagged surface. This file lists what those surfaces leave behind: every key the site keeps in the browser and every request that changes something on the server, each with the experience owner from [Preserved capability ownership](selecta-experience-acceptance.md#preserved-capability-ownership) who must keep it working through a redesign.

**Kept in sync by** `tests/test_ex_0114_side_effect_map.py`: it reads every `localStorage`/`sessionStorage` key in `web/src` and every POST, PUT, PATCH and DELETE route in `src/selecta`, and fails when one is missing here or when a row here no longer exists in the code. Adding, renaming or removing a key or a mutating route therefore means updating this map in the same change, and saying in the PR how old data and old callers are carried over.

**Rule for a redesign:** a key or route may move to a new owner, but it may not silently stop being read or called. A redesign that drops one must say what happens to what is already stored, or to the client still calling it, and the owner signs that off.

**Owner sign-off:** Needs a person: the owner reviews this map against one exact SHA and signs it off as the old/new preservation record.

## Persisted browser state

Keys ending in `<...>` are prefixes: one key per workspace, conversation, room, study or Studio grid.

| Key | Storage | Written by | Holds | Owner |
|---|---|---|---|---|
| `selecta.prefs` | local | `web/src/state/prefs.ts` | Theme, motion, density, rail and library layout choices | Shared foundation |
| `selecta.sound` | local | `web/src/player.ts` | Volume and mute | Listen |
| `selecta-now` | local | `web/src/lib.ts` | Where playback was, so a reload resumes without a surprise | Listen |
| `selecta.listen` | local | `web/src/views/Now.tsx` | Listen display choices (spectrum shape and the like) | Listen |
| `selecta.setUp` | local | `web/src/App.tsx` | That first-run setup has been finished | Onboarding |
| `selecta.startedAMix` | local | `web/src/views/Setup.tsx` | That a first mix has been started | Onboarding |
| `selecta.firstHandoffSeen` | local | `web/src/views/FirstHandoff.tsx` | That the first handoff explanation has been seen, so it is not shown again | Onboarding |
| `selecta.mixLength` | local | `web/src/views/Mixes.tsx` | The last chosen mix length | Make a Mix |
| `selecta.recentDraft` | local | `web/src/views/Mix.tsx`, `web/src/views/MyMixes.tsx` | The draft last edited and its order, for the way back | My Mixes |
| `selecta.inspectorWidth` | local | `web/src/views/Mix.tsx` | Inspector width, clamped 320 to 520 px | Arrangement editor |
| `selecta.energyOverview` | local | `web/src/views/EditorStory.tsx` | Whether the energy overview is open | Arrangement editor |
| `selecta.studio.<seam>` | local | `web/src/views/Studio.tsx` | An unsaved Stem Studio grid, for exact recovery | Studio |
| `selecta.lucy.history` | local | `web/src/views/Lucy.tsx` | Whether Lucy keeps conversation history | Lucy |
| `selecta.lucy.unsent.<conversation>` | local | `web/src/lucy/unsent.ts` | A message typed but not sent | Lucy |
| `selecta.lucy.commit` | session | `web/src/views/LucyApprove.tsx` | A Lucy change waiting for approval in this tab | Lucy |
| `selecta.study.<study>` | session | `web/src/views/Listening.tsx` | Progress through a blind listening study in this tab | Learning |
| `selecta-full-motion` | session | `web/src/ui/lowPower.ts` | That the low-power motion notice was dismissed in this tab | Shared foundation |
| `selecta.device.<workspace>` | local | `web/src/devices/usePlaybackDevice.ts`, `web/src/devices/DevicesPanel.tsx` | This browser's playback device id (Cloud) | Cloud playback |
| `selecta.cloud.last-event-id` | session | `web/src/cloud/events.ts` | The last Cloud event seen, to resume the stream (Cloud) | Cloud |
| `selecta.guest.room.<code>` | local | `web/src/guest/main.ts` (through `store` in `web/src/rooms/dom.ts`) | The guest's room id for a party code (Cloud) | Requests (guest rooms) |

## API side effects

Every route that changes something. GET routes only read and are not listed. Paths are as declared in the Python file named in each heading.

### Mix editing (`src/selecta/routes/edit.py`) - Arrangement editor

| Route | Side effect |
|---|---|
| `POST /api/mix/{position}/leave-later` | Moves a song's way out later after a seek or return |
| `POST /api/mix/pair` | Inserts two songs and their transition at once (idempotent with `x-operation-id`) |
| `POST /api/mix/songs` | Adds a song |
| `DELETE /api/mix/songs/{position}` | Removes a song (guarded by `x-mix-order`) |
| `POST /api/mix/move` | Moves a song |
| `POST /api/mix/{position}/lock` | Locks or unlocks a song |
| `POST /api/mix/{position}/swap` | Replaces the song at a place |
| `POST /api/mix/{position}/seam` | Changes a transition's settings and re-renders it |
| `POST /api/mix/{position}/render` | Renders one transition now |
| `POST /api/mix/render` | Queues every unfinished transition |
| `POST /api/mix/export` | Starts the older one-shot export (Export) |
| `POST /api/seams` | Renders a transition audition between two songs (Discovery) |
| `POST /api/seams/{key}/rate` | Saves a Good/Bad rating for one exact render key (Discovery, learning) |

### Mixes and drafts (`src/selecta/routes/mixes.py`) - My Mixes, Make a Mix

| Route | Side effect |
|---|---|
| `POST /api/playback/skip` | Records how much of a skipped song was heard (Listen, learning) |
| `POST /api/drafts` | Creates a draft |
| `POST /api/drafts/restore` | Restores a deleted draft (Undo) |
| `POST /api/drafts/{draft}/name` | Renames a draft |
| `POST /api/drafts/{draft}/duplicate` | Copies a draft |
| `DELETE /api/drafts/{draft}` | Deletes a draft (restorable) |
| `POST /api/drafts/{draft}/play` | Swaps a draft in as the current mix |
| `POST /api/drafts/{draft}/line` | Puts a draft in the render line |
| `DELETE /api/drafts/{draft}/line` | Takes a draft out of the render line |
| `POST /api/drafts/{draft}/line/move` | Reorders the render line |
| `POST /api/vibes/{key}/build` | Builds a mix from a suggestion (Make a Mix) |
| `POST /api/mix/build` | Builds a mix from shaped choices (Make a Mix) |
| `POST /api/mix/undo` | Undoes the last mix change in its scope |
| `POST /api/mix/clear` | Empties the mix (guarded by `x-mix-order`) |

### Studio and discovery (`src/selecta/routes/discover.py`) - Studio, Discovery, Learning

| Route | Side effect |
|---|---|
| `POST /api/discoveries/{discovery_id}/hear` | Renders a harmonic audition clip |
| `POST /api/mix/{position}/studio` | Separates both songs' stems for a seam |
| `POST /api/mix/{position}/studio/tune` | Arranges or fine-tunes a Studio grid |
| `POST /api/mix/{position}/studio/use` | Renders the chosen grid and makes it the seam |
| `POST /api/discoveries/{discovery_id}/review` | Saves a verdict on a harmonic match |
| `POST /api/listening/{trial}/response` | Saves a blind study answer (Learning) |

### Library (`src/selecta/routes/library.py`) - Library, Workspace

| Route | Side effect |
|---|---|
| `POST /api/scan` | Reads a music folder into the library |
| `POST /api/scan/cancel` | Stops a folder read; what is in stays |
| `POST /api/library/check` | Checks the library for moved or changed files now |
| `POST /api/analysis/start` | Starts analysis |
| `POST /api/analysis/stop` | Pauses analysis |
| `POST /api/songs/{song_id}/priority` | Moves a song up the analysis queue |
| `POST /api/songs/{song_id}/never` | Marks a song Never play (or lifts it) |
| `POST /api/library/batch` | Applies one change to exactly identified songs, atomically |
| `POST /api/songs/{song_id}/correct` | Saves a correction; the detected value is kept for undo |
| `POST /api/songs/{song_id}/analyse` | Analyses one song now |

### Requests (`src/selecta/routes/song_requests.py`) - Requests

| Route | Side effect |
|---|---|
| `POST /api/requests/consider` | Plans pending requests into the mix |
| `POST /api/requests/{request_id}/bridges` | Searches for bridge songs (no mix change) |
| `POST /api/requests/{request_id}/bridge` | Records consent to a bridge song |
| `POST /api/requests/{request_id}/hear` | Renders the route so it can be heard first |
| `POST /api/requests/{request_id}/add` | Forces a request in without a clean route |
| `POST /api/requests/insert` | Joins a ready request into the mix |
| `POST /api/requests` | Asks for a song |
| `DELETE /api/requests/{request_id}` | Cancels a request |

### Exports (`src/selecta/routes/exports.py`) - Export

| Route | Side effect |
|---|---|
| `POST /api/exports/jobs` | Starts a frozen export job (idempotent with `x-operation-id`) |
| `DELETE /api/exports/jobs/{job_id}` | Cancels a waiting export |

### Workspace and setup (`src/selecta/routes/system.py`) - Workspace, Onboarding, Listen

| Route | Side effect |
|---|---|
| `POST /api/storage` | Changes the storage budget for renders and stems |
| `POST /api/backup/preview` | Lists what a local backup would hold |
| `POST /api/backup/stage` | Writes a local backup archive |
| `POST /api/folders/relink/preview` | Shows what relinking a moved folder would change |
| `POST /api/folders/relink` | Points songs at their moved folder |
| `POST /api/folders/stop-watching` | Stops watching a folder; nothing is deleted |
| `POST /api/steer` | Steers the live mix (Listen DJ controls) |
| `POST /api/plan` | Builds a new mix (older entry point to `POST /api/mix/build`) (Listen) |

### Lucy (`src/selecta/routes/lucy.py`) - Lucy

| Route | Side effect |
|---|---|
| `PUT /api/lucy/settings` | Saves Lucy's provider and consent settings |
| `POST /api/lucy/conversations` | Starts a conversation |
| `PATCH /api/lucy/conversations/{conversation}` | Renames or archives a conversation |
| `DELETE /api/lucy/conversations/{conversation}` | Deletes a conversation |
| `POST /api/lucy/conversations/{conversation}/branch` | Branches a conversation |
| `POST /api/lucy/conversations/{conversation}/turns` | Sends a message (may call the chosen AI provider) |
| `POST /api/lucy/conversations/{conversation}/stop` | Stops a reply |
| `POST /api/lucy/conversations/{conversation}/retry` | Retries a reply |
| `POST /api/lucy/proposals/{proposal}/current` | Makes a proposal the current one |
| `POST /api/lucy/revisions/{revision}/edit` | Edits a mix revision |
| `POST /api/lucy/revisions/{revision}/rules/{rule}/remove` | Removes a rule from a revision |
| `POST /api/lucy/revisions/{revision}/restore` | Restores an older revision |
| `POST /api/lucy/revisions/{revision}/branch` | Branches a revision |
| `POST /api/lucy/approvals` | Approves a proposed change |
| `POST /api/lucy/commits` | Applies an approved change to a mix |
| `POST /api/lucy/permissions/{permission}` | Grants or refuses a permission |
| `POST /api/lucy/memory` | Adds a remembered fact |
| `PATCH /api/lucy/memory/{fact}` | Edits a remembered fact |
| `DELETE /api/lucy/memory/{fact}` | Forgets a fact |
| `POST /api/lucy/memory/clear` | Forgets every fact |
| `POST /api/listening/events` | Records listening events for Lucy's memory |

### Cloud account and identity (`src/selecta/api_cloud.py`, `src/selecta/identity/routes.py`, `src/selecta/lucy/cloud_settings.py`, `src/selecta/billing/api.py`) - Cloud

| Route | Side effect |
|---|---|
| `PUT /api/account/labs/{flag_id}` | Turns a Labs feature on or off for the account |
| `POST /api/onboarding/complete` | Marks Cloud onboarding done |
| `POST /api/account/sign-out-everywhere` | Revokes every session |
| `DELETE /api/account` | Hides the account and queues its deletion |
| `POST /api/webhooks/workos` | Stores and acts on a WorkOS event once |
| `POST /api/admin/session` | Starts a privileged admin session |
| `PUT /api/account/lucy` | Saves Cloud Lucy settings |
| `POST /api/billing/checkout` | Opens a Stripe checkout |
| `POST /api/billing/portal` | Opens the Stripe billing portal |
| `POST /api/webhooks/stripe` | Applies a Stripe billing event |

### Cloud playback and storage (`src/selecta/playback/api.py`, `src/selecta/storage/api.py`, `src/selecta/storage/playback_api.py`, `src/selecta/routes/cloud_assets.py`, `src/selecta/routes/cloud_proxy.py`) - Cloud playback

| Route | Side effect |
|---|---|
| `POST /api/devices` | Registers this browser as a playback device |
| `PATCH /api/devices/{device_id}` | Renames a device |
| `POST /api/devices/{device_id}/sign-out` | Signs a device out |
| `POST /api/playback/heartbeat` | Keeps this device's playback lease |
| `POST /api/playback/take-over` | Moves playback to this device |
| `POST /api/playback/reconnect` | Reclaims playback after a drop |
| `POST /api/playback/commands` | Sends a transport command to the playing device |
| `POST /api/uploads/plan` | Plans an upload |
| `POST /api/uploads/{session_id}/parts` | Signs upload parts |
| `POST /api/uploads/{session_id}/complete` | Finishes an upload |
| `DELETE /api/uploads/{session_id}` | Cancels an upload |
| `POST /api/storage/derived-playback-url` | Signs a playback URL |
| `DELETE /api/assets/{asset_id}` | Deletes an uploaded asset |
| `POST /api/assets/{asset_id}/playback-proxy` | Asks for a playback proxy to be made |

### Rooms (`src/selecta/rooms/api_host.py`, `src/selecta/rooms/api_guest.py`) - Requests (guest rooms)

| Route | Side effect |
|---|---|
| `POST /api/rooms` | Opens a party room |
| `PATCH /api/rooms/{room_id}/settings` | Changes room settings |
| `POST /api/rooms/{room_id}/lock` | Locks a room |
| `POST /api/rooms/{room_id}/unlock` | Unlocks a room |
| `POST /api/rooms/{room_id}/code` | Issues a new join code |
| `POST /api/rooms/{room_id}/end` | Ends a room |
| `POST /api/rooms/{room_id}/requests/{request_id}/approve` | Approves a guest request |
| `POST /api/rooms/{room_id}/requests/{request_id}/pass` | Passes on a guest request |
| `POST /api/rooms/{room_id}/guests/{guest_id}/approve` | Lets a guest in |
| `POST /api/rooms/{room_id}/guests/{guest_id}/remove` | Removes a guest |
| `POST /api/rooms/{room_id}/guests/{guest_id}/ban` | Bans a guest |
| `POST /api/rooms/{room_id}/displays` | Pairs a display |
| `DELETE /api/rooms/{room_id}/displays` | Unpairs displays |
| `POST /api/guest/join` | Joins a room as a guest |
| `POST /api/guest/rooms/{room_id}/requests` | A guest asks for a song |
| `DELETE /api/guest/rooms/{room_id}/requests/{request_id}` | A guest withdraws a request |
| `POST /api/guest/rooms/{room_id}/requests/{request_id}/vote` | A guest votes |
| `DELETE /api/guest/rooms/{room_id}/requests/{request_id}/vote` | A guest takes a vote back |
| `PUT /api/guest/rooms/{room_id}/nickname` | A guest changes nickname |
| `POST /api/guest/rooms/{room_id}/leave` | A guest leaves |
| `POST /api/display/pairings` | A display pairs with a room |

### Admin console (`src/selecta/admin/routes.py`, `src/selecta/admin/routes_controls.py`) - Cloud operations

| Route | Side effect |
|---|---|
| `POST /api/admin/jobs/{job_id}/{command}` | Retries, cancels or otherwise acts on a job |
| `POST /api/admin/workers/{worker_id}/{command}` | Drains or acts on a worker |
| `POST /api/admin/accounts/{user_id}/{command}` | Suspends or acts on an account |
| `POST /api/admin/overrides` | Grants an override |
| `POST /api/admin/overrides/mass` | Grants overrides in bulk |
| `DELETE /api/admin/overrides/{override_id}` | Revokes an override |
| `POST /api/admin/security/roles` | Assigns a staff role |
| `PATCH /api/admin/audit/{event_id}` | Refused: the audit log is append-only; the attempt is audited and alerted |
| `DELETE /api/admin/audit/{event_id}` | Refused: the attempt is audited and alerted |
| `POST /api/admin/actions/{action_id}/{command}` | Approves or rejects a two-person action |
| `POST /api/admin/emergency/{control}/{command}` | Turns an emergency control on or off |
| `POST /api/admin/flags/rollback` | Rolls back a flag change |
| `POST /api/admin/flags/{flag_id}/impact` | Estimates a flag change's impact |
| `POST /api/admin/flags/{flag_id}/change` | Changes a flag |
| `POST /api/admin/flags/{flag_id}/preview` | Previews a flag change |
| `POST /api/admin/takedowns` | Logs a takedown notice |
| `POST /api/admin/takedowns/{notice_id}/{command}` | Acts on a takedown notice |
| `POST /api/admin/upload-restrictions/{workspace_id}/lift` | Lifts an upload restriction |

### Worker gateway (`src/selecta/work/gateway_api.py`) - Cloud operations

| Route | Side effect |
|---|---|
| `POST /internal/workers/register` | Registers a worker |
| `POST /internal/workers/refresh` | Refreshes a worker token |
| `POST /internal/workers/claim` | Claims a job attempt |
| `POST /internal/workers/attempts/{attempt_id}/outputs` | Signs output slots |
| `POST /internal/workers/attempts/{attempt_id}/heartbeat` | Keeps an attempt's lease |
| `POST /internal/workers/attempts/{attempt_id}/release` | Gives an attempt back |
| `POST /internal/workers/attempts/{attempt_id}/progress` | Reports progress |
| `POST /internal/workers/attempts/{attempt_id}/complete` | Completes an attempt |
| `POST /internal/workers/attempts/{attempt_id}/fail` | Fails an attempt |
