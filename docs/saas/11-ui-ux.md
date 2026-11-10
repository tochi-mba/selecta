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

### 11.4 Honest status language

- Show stages ("Uploading 3 of 12", "Checking the file", "Analysing", "Ready"), measured counts ("4 of 7 transitions ready") and ranged ETAs from `eta.py`, never a global "you are number 27".
- Distinguish **confirmed failure**, **confirmed success**, **unknown outcome** (network dropped after send: "Checking whether that went through…"), and **accepted, not done**.
- Waiting for capacity says so: "Busy right now. Premium jobs get more processing time" is an honest upsell; no fake slowness, ever.
- Upgrade prompts appear only at real limits, with the specific limit named, and never block access to music already stored.

### 11.5 State matrix every screen is tested against

empty · loading · ready · partially ready · updating · failed · retrying · offline · recovering · over quota · plan changed mid-session · session expired · another tab/device active · feature turned off mid-session · plan-locked feature; at 1440 and 375 px, light and dark, keyboard only, screen reader, reduced motion, 400% zoom, long names, 20,000-song libraries.

---

[← 10-audio-engine-in-cloud.md](10-audio-engine-in-cloud.md) · [Contents](README.md#chapters) · [11a-devices-and-rooms.md →](11a-devices-and-rooms.md)
