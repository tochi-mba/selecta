---
id: T-20261126-1105
title: Uploaded-music mixes (/cloud-mixes) should switch to the account's drafts
area: storage
status: done
priority: high
who: either
created: 2026-11-26
source: docs/engineering/engine-store-mixes.md
commit: 2c84d7b0
---

cloud_mixes (/cloud-mixes, uploaded music) still keeps each Cloud mix as mix_revision artifacts, and the hosted session's card (HostedMix.tsx, hosted_render) reads them. engine_store.mix_import.import_cloud_mixes is written and tested (tests/test_cloud_brain_mixes.py): each Cloud mix becomes a draft whose songs are the catalogue songs with the same content hash, once per mix, never changing a revision. Nothing calls it. Good: the hosted session's owner (the hosted plane, ADR-0456/0457) calls the import when an uploaded-music account moves to the one Cloud shell, points HostedMix and /cloud-mixes reads at the account's drafts behind cloud.account_mixes, and decides what happens to a file with no catalogue song (today it is left out and counted).

2026-11-26: Server side: cloud_brain.mixes_routes calls mix_import.import_cloud_mixes on every use (a read first, so nothing new writes nothing), behind cloud.account_mixes; /cloud-mixes rows never change; a file with no catalogue song is still left out and counted. The browser side has no clean seam (its /cloud-mixes calls are inline in web/src/cloud/MakeCloudMix.tsx, and the hosted shell web/src/cloud/hosted/ has no mix list): filed separately.
