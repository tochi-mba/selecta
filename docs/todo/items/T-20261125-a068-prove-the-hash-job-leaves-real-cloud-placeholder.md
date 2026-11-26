---
id: T-20261125-a068
title: Prove the hash job leaves real cloud placeholders alone
area: library
status: open
priority: high
who: owner
created: 2026-11-25
source: T-20261125-a61f, closed in code
commit:
---

The hash job and analysis's hash skip files Windows marks offline or recall-on-access (and macOS dataless), proven only by a test that fakes the attribute. Before core.engine_store is turned on: put a few songs in a OneDrive folder set to free up space (files on demand), start SelectaDJ Desktop with the flag on, and check that the files stay cloud-only (no download) and their songs have no hash until made available offline.
