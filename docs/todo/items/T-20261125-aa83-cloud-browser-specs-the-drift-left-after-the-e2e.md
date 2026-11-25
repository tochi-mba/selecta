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

Good: every Cloud spec passes, and the suite fits two 30-minute shards. Passing tests take seconds to two minutes each; most of the 52.6 min was failing tests waiting out 20 s timeouts.
