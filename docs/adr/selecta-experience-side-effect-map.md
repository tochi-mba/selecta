# Selecta - persisted state and API side-effect map (EX-0114-04)

This is the second half of the experience-first preservation map. [selecta-experience-feature-parity.md](selecta-experience-feature-parity.md) maps capabilities and [mp-0272-surface-inventory.json](mp-0272-surface-inventory.json) lists every route, tab, overlay and flagged surface. This file lists what those surfaces leave behind: every key the site keeps in the browser and every request that changes something on the server, each with the experience owner from [Preserved capability ownership](selecta-experience-acceptance.md#preserved-capability-ownership) who must keep it working through a redesign.

**Kept in sync by** `tests/test_ex_0114_side_effect_map.py`: it reads every `localStorage`/`sessionStorage` key in `web/src` and every POST, PUT, PATCH and DELETE route in `src/selecta`, and fails when one is missing here or when a row here no longer exists in the code. Adding, renaming or removing a key or a mutating route therefore means updating this map in the same change, and saying in the PR how old data and old callers are carried over.

**Rule for a redesign:** a key or route may move to a new owner, but it may not silently stop being read or called. A redesign that drops one must say what happens to what is already stored, or to the client still calling it, and the owner signs that off.

**Owner sign-off:** Needs a person: the owner reviews this map against one exact SHA and signs it off as the old/new preservation record.

## Persisted browser state

Keys ending in `<...>` are prefixes: one key per workspace, conversation, room, study or Studio grid.

| Key | Storage | Written by | Holds | Owner |
|---|---|---|---|---|
| `selecta.dsp.calibration.` | local | `web/src/cloud/localFirstPlayer.ts` | This device's worker-analysis calibration (one entry per device identity), re-measured when missing or 30 days old | Listen |
| `selecta.dsp.stems.model` | local | `web/src/dsp/stems/model.ts` | Which stem splitter file this browser downloaded and checked (implementation, checksum, size, when), so a ready splitter is not downloaded again; removed when the member removes the splitter | This device |
| `selecta.dsp.stems.crashGuard` | local | `web/src/dsp/stems/gate.ts` | Written just before a stem split runs and removed after, so a page that loads with it still present knows the last split stopped the page | This device |
| `selecta.dsp.stems.crashTripped` | local | `web/src/dsp/stems/gate.ts` | That a stem split stopped the page here, so stems stay off on this device until the member chooses to try again | This device |
| `selecta.dsp.stems.calibration.` | local | `web/src/dsp/stems/gate.ts` | This device's stem-splitting benchmark (one entry per device identity), re-measured when missing or 30 days old | This device |
| `selecta.persist.asked` | local | `web/src/cloud/persistence.ts` | That the one storage-persistence ask after the first import has been made, so no browser re-asks on every import | Cloud storage card |
| `selecta.` | local | `web/src/cloud/deviceData.ts` | A clearing prefix, not a key: Clear everything in this browser removes every `selecta.`-prefixed entry | Cloud device data |
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
| `selecta.workspace.<user>` | local | `web/src/business/workspace.ts` | Last chosen workspace for each signed-in account, restored only for that account | Cloud workspace switcher |
| `selecta.workspace.tab` | session | `web/src/business/workspace.ts` | Workspace chosen in this tab, scoped to the signed-in account | Cloud workspace switcher |
| `selecta.device.<workspace>` | local | `web/src/devices/usePlaybackDevice.ts`, `web/src/devices/DevicesPanel.tsx` | This browser's playback device id (Cloud) | Cloud playback |
| `selecta.cloud.last-event-id` | session | `web/src/cloud/events.ts` | The last Cloud event seen, to resume the stream (Cloud) | Cloud |
| `selecta.guest.room.<code>` | local | `web/src/guest/main.ts` (through `store` in `web/src/rooms/dom.ts`) | The guest's room id for a party code (Cloud) | Requests (guest rooms) |
| `selecta.cutover-notice.<account>` | local | `web/src/cloud/migration/CutoverNotice.tsx` | That this account dismissed the hosted-media cutover notice on this browser (Cloud, ADR-0465) | Cloud |
| `selecta.media-profile.<workspace>` | local | `web/src/cloud/ConnectMusic.tsx` | The workspace's chosen media profile (local-first or hosted), so the shell draws the right home (Cloud, ADR-0463) | Cloud |
| `selecta.import.<workspace>` | local | `web/src/cloud/importSession.ts` | Whether a workspace import is in progress, so an interrupted import can be resumed safely | Cloud |
| `selecta.labs.feedback-draft` | local | `web/src/cloud/labs/LocalFirstLabs.tsx` | Unsubmitted feedback text from the local-first labs page | Cloud |
| `selecta.onboarding.<workspace>` | local | `web/src/cloud/onboarding/state.ts` | How far local-first Cloud onboarding got, so an interrupted step resumes (Cloud, ADR-0463) | Cloud |
| `selecta.venue.last-heard.<workspace>` | local | `web/src/cloud/venue/deps.ts` | When a person last confirmed hearing the venue check tone, shown only as history and never trusted as a current check (Cloud, ADR-0460) | Cloud |
| `selecta.venue.record.<workspace>` | local | `web/src/cloud/venue/deps.ts` | The newest capability record measured on this device, filed under its full tuple (Cloud, ADR-0460) | Cloud |
| `selecta-requests:<workspace>` | local | `web/src/cloud/localFirstRequests.ts` | The songs asked for under Request a song in a browser mix, and which room requests this browser has already placed, so a reload keeps the queue (Cloud, ADR-0462) | Requests |
| `selecta-requests-room:<workspace>` | local | `web/src/cloud/localFirstRequests.ts` | The last room request list the server answered, so Request a song still shows it while the connection is down (Cloud, `cloud.offline_shell`) | Requests |
| `selecta.account-snapshot` | local | `web/src/cloud/offlineCache.ts` | The signed-in person's last account answer (user id, when, account), so a page opened offline still knows its workspace and features; forgotten with the workspace's device data (Cloud, `cloud.offline_shell`) | Cloud |
| `selecta.cloud.verify-asked` | session | `web/src/cloud/Gate.tsx` | That the member pressed "I've verified my email", kept across the reload that follows, so a page that comes back unchanged can say the address still isn't verified (Cloud sign-in) | Cloud |
| `selecta.controller.notices.seen` | local | `web/src/devices/ControllerNotices.tsx` | The ids of the last 60 remote-control notices this browser dismissed, so a dismissed notice stays dismissed across page loads (Cloud, `devices.remote_control`) | Cloud |
| `selecta.debug.auth` | session | `web/src/cloud/authTrail.ts` | The last 20 sign-in problems in this tab (when, where, the error's name, message, status and isTransient; never a token), so a false "Sign in again" can be read afterwards (Cloud sign-in) | Cloud |
| `selecta-mix-outbox-alias:<workspace>` | local | `web/src/cloud/outbox.ts` | Local mix ids matched to the server's once a queued create or edit lands, so later queued changes and a reloaded tab find the right mix (Cloud, `cloud.mix_outbox`) | My Mixes |
| `selecta-mix-outbox-notices:<workspace>` | local | `web/src/cloud/outbox.ts` | The last few plain notices about queued mix changes the server turned down, shown once and then removed (Cloud, `cloud.mix_outbox`) | My Mixes |
| `selecta-cloud-dev:refresh` | local | `web/src/devcloud/authkit.tsx` (development builds only, `vite.cloud-dev.config.ts`) | The local identity service's refresh token, so a reload signs back in; removed on sign-out or a failed refresh | Cloud (local dev stack) |
| `selecta-cloud-dev:login` | session | `web/src/devcloud/authkit.tsx` (development builds only, `vite.cloud-dev.config.ts`) | The PKCE verifier, CSRF state and return path of a sign-in in flight; removed when the code comes back | Cloud (local dev stack) |

IndexedDB databases added for interruption-safe Cloud (not localStorage keys, so not rows above): `selecta-mix-outbox` (`web/src/cloud/outbox.ts`, mix creates and edits made offline, sent on reconnect, `cloud.mix_outbox`), `selecta-media-catalogue-<workspace>` (`web/src/cloud/offlineCache.ts`, the last catalogue answer for the offline Library, `cloud.offline_shell`) and the import journal `selecta-media-journal-ws-<workspace>` (`web/src/media/importJournal.ts`, files already checked by an import, `cloud.resilient_import`).

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
| `POST /api/library/lyrics/again` | Starts an interrupted lyric lookup again (`library.scan_resume`); with durable jobs it queues at most one more |
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
| `POST /api/exports/jobs/{job_id}/again` | Starts an interrupted export again, once, as a new job from its frozen songs and transitions (`library.scan_resume`); with durable jobs nothing is started |

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
| `POST /api/account/labs/local-first/join` | Adds the member's user id to the Labs cohort rule on `cloud.local_first` (a new rule version), only if that really turns browser-first Cloud on |
| `POST /api/account/labs/local-first/leave` | Removes the member's user id from the Labs cohort rule on `cloud.local_first` (a new rule version when it changed) |
| `POST /api/account/labs/local-first/feedback` | Records the member's Labs feedback as a `labs.local_first.feedback` audit event |
| `POST /api/onboarding/complete` | Marks Cloud onboarding done |
| `POST /api/account/sign-out-everywhere` | Revokes every session |
| `DELETE /api/account` | Hides the account and queues its deletion |
| `POST /api/webhooks/workos` | Stores and acts on a WorkOS event once |
| `POST /api/admin/session` | Starts a privileged admin session |
| `PUT /api/account/lucy` | Saves Cloud Lucy settings |
| `PUT /api/lucy-cloud/settings` | Saves the person's Cloud Lucy choices (on/off, phases, sharing), the same store as `PUT /api/account/lucy` |
| `POST /api/lucy-cloud/conversations` | Starts a Lucy conversation for this person in this workspace |
| `PATCH /api/lucy-cloud/conversations/{conversation}` | Renames or archives one of this person's Lucy conversations |
| `DELETE /api/lucy-cloud/conversations/{conversation}` | Deletes a Lucy conversation, its messages, events and proposals; mixes saved from it stay |
| `POST /api/lucy-cloud/conversations/{conversation}/turns` | Stores the person's message, admits a turn through the AI gateway (counts a Lucy turn, takes the run slot, reserves its cost) and starts Lucy's answer |
| `POST /api/lucy-cloud/conversations/{conversation}/retry` | Sends an earlier message again as a new turn (counted like any turn) |
| `POST /api/lucy-cloud/conversations/{conversation}/stop` | Stops Lucy's running answer; the stopped turn is given back |
| `POST /api/lucy-cloud/revisions/{revision}/edit` | Removes or moves a song in Lucy's proposal as a new proposal revision; no mix changes |
| `POST /api/lucy-cloud/proposals/{proposal}/current` | Makes an earlier proposal revision the current one; no mix changes |
| `POST /api/lucy-cloud/approvals` | Checks a proposal can be saved and returns a short-lived approval; nothing is saved |
| `POST /api/lucy-cloud/commits` | Saves an approved proposal as the next recipe revision (or a new recipe), once per idempotency key; Save and play also makes it the account's current mix and publishes `mix.current` |
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
| `POST /api/playback/commands/{command_id}/ack` | Records that the playing device received a command, never that it was audible (ADR-0461) |
| `POST /api/playback/start-asks` | Asks another of the member's own signed-in devices to become the speaker and start; publishes the ask on the workspace event stream, stores nothing (ADR-0475 R2) |
| `POST /api/playback/start-asks/{ask_id}/answer` | The asked device says what it did (starting, needs music, needs a press, no mix, declined); publishes the answer, stores nothing |
| `POST /api/zones/{zone_id}/playback/heartbeat` | Updates a zone's active device lease and accepted playback position |
| `POST /api/zones/{zone_id}/playback/take-over` | Transfers the zone playback lease to this device |
| `POST /api/zones/{zone_id}/playback/reconnect` | Reclaims or reports the zone playback lease after a device reconnects |
| `POST /api/zones/{zone_id}/playback/commands` | Sends a fenced transport command to the zone's active device |
| `POST /api/zones/{zone_id}/playback/commands/{command_id}/ack` | Records delivery acknowledgement for a zone command, never that it was audible |
| `POST /api/zones/{zone_id}/playback/hand-back` | Hands zone playback back and records the current position |
| `POST /api/uploads/plan` | Plans an upload |
| `POST /api/uploads/{session_id}/parts` | Signs upload parts |
| `POST /api/uploads/{session_id}/complete` | Finishes an upload |
| `DELETE /api/uploads/{session_id}` | Cancels an upload |
| `POST /api/storage/derived-playback-url` | Signs a playback URL |
| `DELETE /api/assets/{asset_id}` | Deletes an uploaded asset |
| `POST /api/assets/{asset_id}/playback-proxy` | Asks for a playback proxy to be made |

### Local media catalogue (`src/selecta/local_media/api.py`) - Cloud library (ADR-0458)

Metadata only: no audio leaves the member's devices. Dark in the build until `cloud.local_media` ships.

| Route | Side effect |
|---|---|
| `POST /api/local-media/songs` | Registers songs on the member's own devices in the workspace catalogue |
| `POST /api/local-media/songs/never` | Sets or clears Never play on a batch of the workspace's catalogue songs, all or none |
| `DELETE /api/local-media/songs/{song_id}` | Soft-deletes a catalogue entry |
| `POST /api/local-media/availability` | Reports which catalogue songs a device holds right now |
| `POST /api/local-media/recipes` | Saves a new portable recipe (a mix over catalogue songs) as its first immutable revision |
| `POST /api/local-media/recipes/{mix_id}/revisions` | Saves the next immutable revision of a recipe, refused when made from a stale one |
| `POST /api/local-media/recipes/{mix_id}/duplicate` | Copies the latest recipe revision into a new recipe with a fresh identity |
| `DELETE /api/local-media/recipes/{mix_id}` | Deletes a recipe and its revisions from this workspace; a recipe that was the current mix stops being current, and `mix.current` is published |
| `PUT /api/local-media/current` | Sets or clears the workspace's current mix, compare-and-set against the one the device last saw; publishes `mix.current` on the workspace event stream (ADR-0475 R8) |

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
| `POST /api/room-requests/{request_id}/played` | Records that the host's browser mix placed an accepted room request, so the room shows it as played |
| `POST /api/room-requests/{request_id}/dismiss` | Lets an accepted room request go from the host's browser list, so the guest sees the host passed on it |
| `POST /api/room-requests/{request_id}/waiting` | Undoes `played`: a played room request of a room still open goes back to accepted, so the host can add it again; anything else is left as it is |
| `POST /api/rooms/{room_id}/guests/{guest_id}/approve` | Lets a guest in |
| `POST /api/rooms/{room_id}/guests/{guest_id}/remove` | Removes a guest |
| `POST /api/rooms/{room_id}/guests/{guest_id}/ban` | Bans a guest |
| `POST /api/rooms/{room_id}/displays` | Pairs a display |
| `DELETE /api/rooms/{room_id}/displays` | Unpairs displays |
| `POST /api/guest/join` | Joins a room as a guest |
| `POST /api/guest/rooms/{room_id}/requests` | A guest asks for a song |
| `POST /api/guest/rooms/{room_id}/requests/batch` | A guest asks for several songs at once; each is accepted or refused on its own |
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

### Business venues and Autopilot (`src/selecta/routes/business_hours.py`, `src/selecta/routes/autopilot.py`) - Venue operations

| Route | Side effect |
|---|---|
| `DELETE /api/autopilot/venues/{venue_id}/overrides/{override_id}` | Revokes an Autopilot override |
| `DELETE /api/business/venues/{venue_id}/hour-exceptions/{exception_id}` | Removes one venue-hours exception |
| `POST /api/autopilot/sessions` | Creates an Autopilot session |
| `POST /api/autopilot/sessions/{session_id}/controls/{control}` | Issues a guarded session control, preserving staff takeover |
| `POST /api/autopilot/sessions/{session_id}/transitions` | Records or starts an authorized session transition |
| `POST /api/autopilot/venues/{venue_id}/candidates` | Sets candidates for the venue |
| `POST /api/autopilot/venues/{venue_id}/overrides` | Adds a timed policy override |
| `POST /api/autopilot/venues/{venue_id}/policies` | Creates a venue policy revision |
| `POST /api/business/venues/{venue_id}/close-now` | Closes the venue early |
| `POST /api/business/venues/{venue_id}/close-now/{override_id}/undo` | Undoes a close-now override |
| `POST /api/business/venues/{venue_id}/hour-exceptions` | Adds an opening-hours exception |
| `POST /api/business/venues/{venue_id}/stay-open-late` | Extends the current opening window |
| `PUT /api/autopilot/venues/{venue_id}/setup/{step}` | Changes a specific venue setup step |
| `PUT /api/business/venues/{venue_id}/hours` | Replaces the weekly opening hours |

### Business, Autopilot, Cloud mixes and venue-room mutations (ADR-0418, ADR-0441-0454)

These endpoints preserve separate Cloud, business and venue ownership. Each request still requires its feature gate, credentials and tenant scope; a route's presence here does not authorise a caller.

| Route | Side effect |
|---|---|
| `DELETE /api/business/crates/{crate_id}` | Removes a venue crate belonging to an authorised organisation |
| `DELETE /api/display/pairing` | Revokes the current display pairing |
| `DELETE /api/rooms/{room_id}/displays/{display_id}` | Removes a paired room display |
| `PATCH /api/business/venues/{venue_id}` | Updates a venue's saved details |
| `PATCH /api/business/zones/{zone_id}` | Updates a zone's saved configuration |
| `PATCH /api/zones/{zone_id}/room` | Updates a standing venue room |
| `POST /api/autopilot/transitions/check` | Records or evaluates a proposed Autopilot transition |
| `POST /api/business/crates` | Creates a venue crate |
| `POST /api/business/orgs` | Creates a business organisation workspace |
| `POST /api/business/venues` | Creates a venue in an organisation |
| `POST /api/business/venues/{venue_id}/archive` | Archives a business venue |
| `POST /api/business/zones` | Creates a playback zone |
| `POST /api/business/zones/{zone_id}/archive` | Archives a zone |
| `POST /api/business/zones/{zone_id}/commands` | Submits a zone playback control |
| `POST /api/cloud-mixes` | Creates a Cloud mix |
| `POST /api/cloud-mixes/{mix_id}/revisions` | Creates a revision of an existing Cloud mix |
| `POST /api/venue-rooms/{code}/join` | Adds a guest to a venue room |
| `POST /api/venue-rooms/{code}/requests` | Submits a guest song request |
| `POST /api/venue-rooms/{code}/requests/{request_id}/vote` | Records a guest vote |
| `POST /api/venue/staff/{session_id}/commands` | Issues a venue staff playback command |
| `POST /api/venue/staff/{session_id}/stop` | Stops an authorised venue staff session |
| `POST /api/zones/{zone_id}/requests/{request_id}/approve` | Approves a standing-room request |
| `POST /api/zones/{zone_id}/requests/{request_id}/pass` | Passes over a standing-room request |
| `POST /api/zones/{zone_id}/room/guests/{guest_id}/ban` | Bans a venue-room guest |
| `POST /api/zones/{zone_id}/room/guests/{guest_id}/remove` | Removes a venue-room guest |
| `POST /api/zones/{zone_id}/room/pause` | Pauses a standing room's requests |
| `POST /api/zones/{zone_id}/room/resume` | Resumes a standing room's requests |
| `POST /api/zones/{zone_id}/room/rotate` | Rotates a standing room's guest code |
| `POST /api/zones/{zone_id}/venue-network` | Registers a venue network for abuse limits |
| `PUT /api/business/crates/{crate_id}/songs` | Replaces a venue crate's song list |
| `PUT /api/business/zones/{zone_id}/cache-report` | Updates a zone kiosk's cache readiness |
| `PUT /api/business/zones/{zone_id}/programme` | Replaces a zone's scheduled programme |
| `POST /api/admin/business/pilots` | Creates a staff-authorised time-limited business pilot |

## Business integration additions

| Route | Side effect |
|---|---|
| `DELETE /api/business/content/blocklist/{entry_id}` | Removes a content blocklist entry |
| `DELETE /api/business/people/{user_id}` | Removes organisation access and revokes personal devices while preserving kiosks |
| `DELETE /api/business/zones/{zone_id}/content/overrides/{override_id}` | Ends a content-rule override |
| `DELETE /api/devices/{device_id}/kiosk` | Revokes the kiosk pairing |
| `PATCH /api/business/orgs/{org_id}` | Updates organisation details |
| `POST /api/admin/business/orgs/{org_id}/billing/credit` | Issues an audited billing credit |
| `POST /api/admin/business/orgs/{org_id}/billing/refund` | Issues an audited refund for an organisation-owned charge |
| `POST /api/admin/business/orgs/{org_id}/contracts` | Records a staff-authorised enterprise contract |
| `POST /api/admin/business/orgs/{org_id}/contracts/{contract_id}/revoke` | Revokes the named enterprise contract |
| `POST /api/admin/business/orgs/{org_id}/slo-credits/{proposal_id}/approve` | Approves an SLO credit proposal |
| `POST /api/admin/business/orgs/{org_id}/slo-credits/{proposal_id}/reject` | Rejects an SLO credit proposal |
| `POST /api/admin/business/pilots/{pilot_id}/{action}` | Extends, ends or updates a staff-managed pilot |
| `POST /api/business/billing/checkout` | Starts a business billing checkout session |
| `POST /api/business/billing/checkout/complete` | Confirms completed business checkout and persists the billing setup |
| `POST /api/business/billing/downgrade` | Schedules a lower business plan and its quantity changes |
| `POST /api/business/billing/preview` | Calculates a billing preview without charging |
| `POST /api/business/billing/stripe-webhook` | Verifies the business Stripe signature and applies the idempotent billing event |
| `POST /api/business/billing/transfers` | Creates a venue ownership-transfer proposal |
| `POST /api/business/billing/transfers/{transfer_id}/accept` | Accepts a venue transfer into the destination organisation |
| `POST /api/business/billing/transfers/{transfer_id}/cancel` | Cancels a pending venue transfer |
| `POST /api/business/billing/venues/{venue_id}/resume` | Resumes a paused venue with billing checks |
| `POST /api/business/content/blocklist` | Adds a content blocklist entry |
| `POST /api/business/content/bulk/apply` | Applies a content-edit batch with an undo record |
| `POST /api/business/content/bulk/preview` | Calculates content-edit changes without applying them |
| `POST /api/business/content/bulk/{batch_id}/undo` | Restores the values from a content-edit batch |
| `POST /api/business/content/import/apply` | Applies a validated content CSV import |
| `POST /api/business/content/import/preview` | Validates and previews a content CSV import |
| `POST /api/business/invitations` | Creates and emails a scoped organisation invitation |
| `POST /api/business/invitations/accept` | Accepts an invitation and adds its scoped membership |
| `POST /api/business/invitations/{invitation_id}/revoke` | Revokes an unaccepted invitation |
| `POST /api/business/library/copy-from-personal` | Copies selected personal assets into the organisation library without moving originals |
| `POST /api/business/library/explicit` | Updates explicit-content classifications in bulk |
| `POST /api/business/pilot-interest` | Sends a pilot enquiry to the configured sales destination |
| `POST /api/business/schedules/apply` | Applies programmes across the authorised zones |
| `POST /api/business/terms/accept` | Records acceptance of the current business terms |
| `POST /api/business/uploads/attestation` | Records the uploader rights attestation |
| `POST /api/business/venues/{venue_id}/licence/extend` | Extends the venue licence attestation |
| `POST /api/business/venues/{venue_id}/pin` | Validates the venue staff PIN with lockout enforcement |
| `POST /api/business/zone-alerts/{alert_id}/acknowledge` | Acknowledges a venue playback alert |
| `POST /api/business/zones/{zone_id}/content/overrides` | Creates a scoped content-rule override |
| `POST /api/business/zones/{zone_id}/speaker/segment-url` | Issues a scoped short-lived URL for a zone speaker segment |
| `POST /api/kiosk/health` | Records kiosk health and updates alerts |
| `POST /api/kiosk/heartbeat` | Renews the kiosk lease and reports its current position |
| `POST /api/kiosk/pair` | Binds a pairing session to an authorised zone |
| `POST /api/kiosk/pairings` | Creates a short-lived kiosk pairing session |
| `POST /api/kiosk/pin` | Validates the staff PIN and applies failed-attempt lockout |
| `POST /api/kiosk/requests/{request_id}/played` | Records a kiosk request as played |
| `POST /api/kiosk/resync` | Reconciles offline kiosk plays and commands with the zone |
| `POST /api/kiosk/segment-url` | Issues a scoped short-lived URL for a paired kiosk segment |
| `POST /api/zones/{zone_id}/requests/{request_id}/played` | Marks a zone room request played |
| `POST /dev/mail/clear` | Clears the development inbox after the same-site check |
| `PUT /api/business/always-open` | Updates always-open usage settings |
| `PUT /api/business/billing/collection-method` | Changes the billing collection method |
| `PUT /api/business/billing/po-number` | Updates the organisation purchase order reference |
| `PUT /api/business/billing/venues/{venue_id}/cost-centre` | Updates the venue invoice cost centre |
| `PUT /api/business/content/rules` | Replaces organisation content rules and invalidates future plans |
| `PUT /api/business/content/songs/{song_id}/clean-link` | Links a song to its clean edit |
| `PUT /api/business/content/songs/{song_id}/explicit` | Updates a song explicit-content classification |
| `PUT /api/business/library/songs/{song_id}/isrc` | Records the song ISRC used in licence reports |
| `PUT /api/business/orgs/{org_id}/setup` | Saves onboarding progress for the organisation |
| `PUT /api/business/play-log/retention` | Updates play-log retention |
| `PUT /api/business/seats` | Updates paid seat quantities with billing enforcement |
| `PUT /api/business/settings/mix-exports` | Changes whether business mixes may be exported |
| `PUT /api/business/venues/{venue_id}/closing-mode` | Changes the venue closing behaviour |
| `PUT /api/business/venues/{venue_id}/content/rules` | Replaces venue content rules and invalidates future plans |
| `PUT /api/business/venues/{venue_id}/licence` | Saves a venue licence attestation |
