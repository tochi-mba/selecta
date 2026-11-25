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

Cloud E2E had not run green since 22 Nov (see commit 30eed4ef). With the build fixed, these still fail locally: (1) bf-accessibility 78: label-content-name-mismatch on a '.link' on the local-first /library (both themes, 320 and 1280); (2) bf-accessibility 197: staff console pages fail WCAG (a click times out first); (3) bf-accessibility 230: guest page '.g-name' label-content-name-mismatch, and the display pairing page has aria-prohibited-attr on #d-pairing and scrolls sideways by 47px at 320 px; (4) admin-flags 61: the Premium host's room panel never shows its 'Big screen' heading. Not yet run locally: flags.cloud.ts and the rest of the suite. Good: every Cloud spec passes, and the job fits its 30 minutes (each failing test burned about 20 s to 2 min of the budget).
