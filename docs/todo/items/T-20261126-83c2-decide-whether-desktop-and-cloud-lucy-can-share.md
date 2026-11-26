---
id: T-20261126-83c2
title: Decide whether Desktop and Cloud Lucy can share one set of conversation tables
area: lucy
status: open
priority: later
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-lucy.md
commit:
---

Desktop Lucy (lucy_* tables, engine_store.lucy, lib0011lucy) and Cloud Lucy (lucy_cloud_* tables, bf0476lucy01) keep separate tables. Conversations, turns, messages and events are close cousins (Cloud adds user_id, a device per turn and epoch times); proposals differ in kind (Desktop: pointer, immutable revisions, approvals and commit records making a draft; Cloud: one row per revision saving to a recipe revision). Good looks like: a decision on one shared shape for the first four, then whether proposals can share, with a migration plan that copies no conversation without the owner's say. Not started; Cloud Lucy's behaviour must not change.
