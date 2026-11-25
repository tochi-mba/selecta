---
id: T-20261125-2a73
title: Cloud writes have no time limit
area: infra
status: open
priority: normal
who: claude
created: 2026-11-25
source: Dead-end audit, 2026-11-25
commit:
---

web/src/cloud/resilientRequest.ts resilient() gives only GETs a time limit (readTimeoutMs). A POST/PUT/DELETE whose server never answers leaves any busy state that is not inside ui Action (its own limit) waiting for ever: SavedBrowserMixes Saving, WorkspaceNameOffer Saving, RoomSettings Locking, RemoteQueue Clearing, labs Joining, HostedMix plan. Good: a generous write limit (about 60 s) that throws TimeoutError with the existing 'took too long' words, safe to repeat because cloud.idempotency keys every write; decide what happens when the flag is off (no key) before turning it on.
