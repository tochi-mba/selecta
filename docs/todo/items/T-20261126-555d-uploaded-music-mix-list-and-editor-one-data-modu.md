---
id: T-20261126-555d
title: Uploaded-music mix list and editor: one data module so they can read the account's drafts
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-library-walkthrough.md section 12 (one brain, Phase 6)
commit:
---

The server brings each /cloud-mixes mix in as an account draft (mix_import.import_cloud_mixes, on first use of the account mix routes, behind cloud.account_mixes), but the browser still keeps uploaded-music mixes in /cloud-mixes: web/src/cloud/MakeCloudMix.tsx makes its four calls inline (GET /cloud-mixes, GET /cloud-mixes/{id}, POST /cloud-mixes, POST /cloud-mixes/{id}/revisions), and the hosted shell (web/src/cloud/hosted/) has no mix list or editor of its own, so there is no one place to switch. Good: a small module (for example web/src/cloud/cloudMixStore.ts) owns those four calls with the component's shapes; with cloud.account_mixes and flagListed it answers from GET /api/drafts, GET /api/mix?draft=, POST /api/drafts with PUT /api/mix/order?draft=, mapping asset ids to catalogue song ids by content hash, and falls back to /cloud-mixes on any failure; MakeCloudMix.tsx calls the module and its tests are unchanged with the flag off.
