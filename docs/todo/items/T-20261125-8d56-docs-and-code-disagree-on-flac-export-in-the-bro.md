---
id: T-20261125-8d56
title: Docs and code disagree on FLAC export in the browser
area: docs
status: open
priority: normal
who: claude
created: 2026-11-25
source: ADR-0477 and the owner's plan approval, 2026-11-25
commit:
---

ADR-0457 says FLAC waits for a vetted encoder; web/src/engine/flac.ts flacSupported() answers supported. Good looks like: one of them is corrected, with a test for the other.
