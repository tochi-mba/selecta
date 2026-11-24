*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 11. UI and UX changes

The music-first app stays recognisable: same five destinations, same design tokens, same accessibility bar. Changes concentrate on accounts, uploads, honest async status, plans, and removing machine settings.

### 11.1 New screens and areas

| Area | Contents |
|---|---|
| Marketing site (separate static site) | What Selecta does, audio examples, pricing, FAQ, legal pages, sign-in |
| Sign up / sign in | AuthKit hosted pages styled to Selecta; email verification; age statement |
| Onboarding | "Add your music" (drag and drop, folder picker) → live upload + analysis progress → first mix unlocks at 6 ready songs (existing rule) → short tour |
| Upload manager | Global tray in the shell: per-file and batch progress, pause/resume/cancel/retry, duplicates (skip/keep), rejected files with reasons, storage meter, survives refresh |
| Account | Profile, email, password/passkeys, sessions and devices, connected sign-in methods, delete account |
| Plan & billing | Current plan, usage meters (storage, analysis today, Lucy turns, exports), upgrade/downgrade (Checkout/Portal), invoices, over-quota guidance |
| Data & privacy | Download my data (originals + mixes + settings JSON), AI data-sharing toggles, retention explained |
| Notifications | Email for long jobs finishing, payment problems, over-quota, storage deletion warnings; in-app Activity |
| Help | FAQ, contact support, copy diagnostic id |
| Devices | Account → Devices list; "Playing on…" bar with remote controls on every non-playing device; "Play here" ([§11A.1](11a-devices-and-rooms.md#11a1-devices-and-the-playback-session)) |
| Rooms | Room panel on Listen (QR, code, settings, requests inbox, guests); guest page `/r/{code}`; big-screen display `/display` ([§11A.2](11a-devices-and-rooms.md#11a2-rooms-premium)) |
| Admin console | [§7.5](07-identity-rbac-admin.md#75-admin-console-v1-six-pages-before-beta) |

### 11.2 Changes to existing screens (by file)

| File | Change |
|---|---|
| `views/Start.tsx`, `views/Setup.tsx` | Cloud mode replaces the folder-path field with the upload flow; step 1 becomes "Add your music"; LRCLIB/"stays on this PC" copy becomes the cloud privacy note |
| `views/Library.tsx`, `state/readiness.ts` | New states: uploading, verifying, rejected, deleting; storage meter; "Upload" action; batch delete; song sheet shows file size and upload date |
| `views/Workshop.tsx`, `WorkshopPanels.tsx` | Tabs in cloud mode: Overview (activity), Analysis, Uploads (replaces Sources), Plan & storage (replaces Storage: no disk slider), Learning; Diagnostics → staff-only |
| `views/LocalBackup.tsx` | Local mode only; cloud mode gets "Download my data" |
| `views/LucySettings.tsx`, `LucyGate.tsx` | Mode-aware per [§9.5](09-lucy-ai-gateway.md#95-settings-split); usage meter (the data already in `lucy/reducer.ts`) |
| `views/Mixes.tsx`, `MyMixes.tsx`, `Drafts.tsx` | Readiness reflects server jobs; render line explains "your order within your account" without global queue positions |
| `views/ExportPanel.tsx`, `ExportJobs.tsx` | Exports count against storage while kept; expiry date shown; "Restart Selecta" copy removed in cloud |
| `views/Now.tsx`, `player.ts` | Cross-origin fetch of proxies with signed URLs, refresh-on-403, preload one ahead, "playing on another device", mobile data note |
| `shell/Shell.tsx`, `manifest.ts` | Account menu (avatar), plan chip, upload tray, Activity backed by server events |
| `ui/glossaryTerms.ts` and the 27 "this PC" strings | A copy layer keyed by mode (`copy.local` / `copy.cloud`) |
| `e2e/pages.e2e.ts` "only talks to this computer" | Mode-aware: local keeps it; cloud asserts only allowlisted origins (API, R2, Stripe, AuthKit) |

### 11.3 Real-time updates

Replace most polling with **one SSE stream per signed-in tab** (`/api/events`): job state changes, upload status, entitlement changes, Lucy events. Heartbeat comments every 20 s (Cloudflare idle limits), resume with `Last-Event-ID`, fan-out across API instances via Postgres `LISTEN/NOTIFY` from the outbox, on one direct (non-pooled) connection per instance, catching up by event id after any gap. Existing `useVisiblePoll` stays as the fallback when SSE drops. **Today:** each API instance's `OutboxFanout` (`work/fanout.py`) listens on `selecta_outbox` through one direct connection and wakes every open stream on that instance when any instance commits an event; a stream arms its wake-up before it reads, then reads only its workspace's rows from its cursor. While listening a stream re-polls only every 15 s as a backstop; without notifications (SQLite, or while the listener reconnects) it polls every 2 s. `tests/test_cloud_fanout.py` commits on one instance's engine and times the event reaching a stream served by another over HTTP.

Current implementation (`web/src/cloud/events.ts`): the Cloud site reads `/api/events` with `fetch` (EventSource can't send the bearer token), keeps the last event id per tab in `sessionStorage` and sends it back as `Last-Event-ID`, and reconnects at once when the server ends a stream. A stream that errors, isn't `text/event-stream`, or is silent for 45 seconds counts as blocked: the tab switches to `useVisiblePoll` (every 10 seconds, re-reading the account), says "Live updates are paused on this network", keeps retrying the stream with a doubling wait up to 30 seconds, and reads once more when it comes back. `entitlement.*`, `quota.*` and `account.*` events re-read the account; `upload.*` and `asset.*` also reload the library.

### 11.3a Cloud screens as built

- **Plan & billing** (`web/src/cloud/Billing.tsx`, `Meters.tsx`): current plan and Lucy level, four meters from `/api/account` `usage` (storage used of limit, analysis today, Lucy turns this month, exports this month), each with its reset date in the account's timezone, and fair use said in words where a plan has no limit. Free accounts subscribe through Checkout after three separate tick boxes (terms, immediate access, the 14-day cancellation right); the request sends the server's `billing.consent_version`. Paid accounts upgrade, downgrade or cancel in the Stripe portal. Returning from Checkout shows "Confirming your payment…" and only says "You're on Premium" once `/api/account` shows the new plan (re-read every 2 seconds and on `entitlement.changed`), with a plain message if it takes more than a minute.
- **Over quota** (`OverQuota.tsx`): a banner on every page names the overage ("You're 35.0 GB over Free's 10.0 GB") with Manage storage (the library) and Upgrade; Add music is disabled with the reason; listening, removing songs and Download my data keep working.
- **Add music** (`Uploads.tsx`, `uploadParts.ts`): unfinished upload sessions are listed from `GET /api/uploads`, so they survive a refresh; choosing the same file again (same size and SHA-256) carries on from the parts already in storage without planning it again.
- **Library playback** (`Library.tsx`, `useCloudPlayer.ts`): Listen starts a run to the end of the list. Once a song plays, the next one's playback file is prepared and downloaded in full (shown as "Up next: ... · loaded") and the hand-over uses that copy. A media error refreshes the signed URL once, restoring the playhead and play state without changing the queue; a second failure on the same song is reported. Cloud has no mixes with transitions yet, so only the next song is buffered.
- **Listen** (`rooms/CloudListen.tsx`, mounted by `CloudApp.tsx` at `/listen`): the "Playing on..." bar and the host's room panel ([§11A](11a-devices-and-rooms.md)).
- **Account** (`AccountData.tsx`, `devices/DevicesPanel.tsx`, `views/LucyCloudSettings.tsx`): Download my data saves the export ZIP; the signed-in devices list follows; Lucy's Cloud settings show the plan's Lucy level, this month's turns and only the person's own choices (Use Lucy, phases, the two sharing choices). Local mode keeps `views/LucySettings.tsx` unchanged.

### 11.3b One shell (ADR-0462, ADR-0468)

Every signed-in Cloud account is drawn by the same shared shell as local SelectaDJ (`web/src/shell/Shell.tsx` with the manifest and router), or, while one flag is off, by the legacy Cloud rail. `web/src/cloud/CloudApp.tsx` decides which, once the account is known:

- **Local-first shell.** An account with the local-first experience and `cloud.local_first` on gets `LocalFirstShell.tsx`: the shared shell with the browser engine, the device library, saved browser recipes in My Mixes, the server-free command palette, shortcuts and media keys (`cloud/serverFreeControls.tsx`), and the account places (Account, Plan & billing, Devices, Rooms) in More.
- **Hosted on the shared shell (`cloud.hosted_shell`).** Every other account, when the server decides `cloud.hosted_shell` on for it, gets `HostedShell.tsx`: the same shell, manifest and router, with the hosted pages (overview, Listen, Make a Mix, Library) as its children and the account places in More exactly as the local-first shell has them; Add music appears in More only with `cloud.uploads`. Hosted playback stays the `CloudTransportDock`'s own media element in the dock slot, and the shell gets a null player facade, so no engine, media store or DSP enters the hosted bundle (`importBoundaries.test.ts`, `routeChunks.test.ts`). Features that need this computer's server or the browser engine (requests, the editor, drafts, Activity, the command palette, shortcuts) are switched off while the hosted shell is open, so their buttons are gone rather than dead. Each page sits in its own `Section`, so a render error in one never blanks the app.
- **Legacy rail.** With `cloud.hosted_shell` off, the `.cloud-shell` rail renders exactly as before; `web/e2e-cloud/hosted-shell.cloud.ts` checks it is byte for byte what it was, and that flag on renders the hosted pages in the shared shell engine-free.

`cloud.hosted_shell` is registered off by default (`src/selecta/flags/cloud.json`) and on in the development posture (`dev.cmd cloud`). **Retirement path:** once the flag has baked (on for every hosted account through the ADR-0467 rollout with no regressions), a later PR deletes the legacy rail markup in `CloudApp.tsx`, the `.cloud-shell` and `.cloud-rail` rules in `cloud/cloud.css` and the flag-off check, then retires the flag. Nothing in PR #96 removes the legacy rail.

### 11.3c Every device a controller (ADR-0475)

In the local-first shell (`devices.remote_control`) a device's Listen, Library and Requests are drawn by what each of the person's devices holds, not only this one ([§11A](11a-devices-and-rooms.md)):
- **Listen** (`cloud/LocalFirstShell.tsx`): `devices/RemoteListen.tsx` while another device plays (with the ways on when that device is away or a press finds nobody playing), `devices/ControllerListen.tsx` when nothing plays and this device has no music, the ordinary Listen otherwise. A Play button is never shown where it cannot work.
- **Library** (`cloud/CloudLibrary.tsx`, `views/LibraryBrowser.tsx`, `views/LibraryRow.tsx`): "All on {device}" in the header, a per-row device status, the filters All, On this device, Can play now and Needs attention, one quiet line instead of the "connect your music" card when another device has the music, and, on a browser that cannot keep folder access (phones), one sentence saying so.
- **Requests** (`cloud/localFirstRequests.ts`, `rooms/RoomRequests.tsx`, `views/BrowserRequests.tsx`): rows judged by the device that would play the song, counts of what this device can add, and "N requests waiting on a device" in the room line.

### 11.4 Honest status language

- Show stages ("Uploading 3 of 12", "Checking the file", "Analysing", "Ready"), measured counts ("4 of 7 transitions ready") and ranged ETAs from `eta.py`, never a global "you are number 27".
- Distinguish **confirmed failure**, **confirmed success**, **unknown outcome** (network dropped after send: "Checking whether that went through…"), and **accepted, not done**.
- Waiting for capacity says so: "Busy right now. Premium jobs get more processing time" is an honest upsell; no fake slowness, ever.
- Upgrade prompts appear only at real limits, with the specific limit named, and never block access to music already stored.

### 11.5 State matrix every screen is tested against

empty · loading · ready · partially ready · updating · failed · retrying · offline · recovering · over quota · plan changed mid-session · session expired · another tab/device active · feature turned off mid-session · plan-locked feature; at 1440 and 375 px, light and dark, keyboard only, screen reader, reduced motion, 400% zoom, long names, 20,000-song libraries.

---

[← 10-audio-engine-in-cloud.md](10-audio-engine-in-cloud.md) · [Contents](README.md#chapters) · [11a-devices-and-rooms.md →](11a-devices-and-rooms.md)
