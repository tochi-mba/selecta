---
id: T-20261125-aa83
title: Cloud browser specs: the drift left after the e2e build was fixed
area: ci
status: open
priority: now
who: claude
created: 2026-11-25
source: PR #137 Cloud E2E, local runs at 30eed4ef
commit:
---

Cloud E2E had not run green since 22 Nov: 57acb155 changed the Cloud defaults (local-first and the shared shell on, hosted media a staff grant) without changing the e2e server, and the specs kept being written against both worlds. Fixed so far (commits 30eed4ef and the one closing this note): the test build turns cloud.local_first, cloud.hosted_shell and cloud.rate_limits off by name and grants hosted media to everyone with a rule; the fake AuthKit keeps one user (CloudApp read /api/account in a loop); localFirst.ts also turns on the flags that need local-first; several real accessibility bugs.

Full local run (one worker, as CI): 162 tests, 52.6 min with 75 failing; after the setup fixes 71 of those still fail. By file: flags.cloud.ts 31 (the sweep's surface lists and marks no longer match the registry: 23 flags "name no cloud surface", per-flag reflow checks), nothing-lost 8 (offline banner and chip words), sign-in 6 (the welcome heading "Your music, ready to move." is gone), onboarding-progressive 3, billing 3 (the "Analysis today" region), storage 2, local-first-shell/mixes/library 6 (for example the "Connect music" heading), hosted-shell 2 (delete-account words from 6bf0545e), guest 2 (room status reads "Locked", not "Locked: no new guests"), and one each in pwa-install, presence, live, display, devices, devices-held-presses, admin-flags (cancelling a waiting action no longer shows a "Cancelled:" status). Each is a product change since 22 Nov that the spec never followed; each needs the owning area to say which side is right.

flags.cloud.ts is done: all 61 of its tests pass locally (one worker, SQLite). The sweep now records the business.* flags and the two local-first-shell features (cloud.browser_harmonic, lucy.cloud_conversation) as covered by other specs (to-dos T-20261125-5322 and T-20261125-83f5 bring them into the sweep), takes the Browser-first defaults as the registry ships them, allows the one GET /api/rooms/current a plan-locked Listen page makes on purpose (a downgraded host keeps the open room, e3db7234), and follows the rooms teaser, the billing plan radios, the Library's Connect music button and the phone-only More. No product code changed. Locally, SQLite "database is locked" waits can leave a page busy past 20 s; on a rerun those tests pass, and CI uses PostgreSQL.

Devices, rooms and local-first files are done (2026-11-25, branch e2e/devices-rooms): local-first-shell, local-first-mixes, local-first-library, guest, pwa-install, presence, live, display, devices, devices-held-presses, bf-accessibility and admin-flags. Mostly redesigned copy and controls the specs never followed (room actions in the Room options menu, toasts instead of lines, the guest page and big screen, R9's Paused on, the Lucy card, the storage meter, the Library's one status chip). Product fixes: the test harness mounts the Toaster the Cloud app has; a browser reports its songs once it is registered, and Play waits for that report before trusting the server's count (ADR-0475 R1); the missed-presses notice keeps Dismiss pressable on a phone. Fixtures now give connected files their real fingerprint. admin-flags was not a console bug: the Cancel press landed in the 500 ms arming window (T-20261125-557c). billing.cloud.ts still posts the retired lucy_turn.haiku allowance (use lucy_turn.everyday).

Good: every Cloud spec passes, and the suite fits two 30-minute shards. Passing tests take seconds to two minutes each; most of the 52.6 min was failing tests waiting out 20 s timeouts.
