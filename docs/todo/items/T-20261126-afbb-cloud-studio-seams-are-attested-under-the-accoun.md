---
id: T-20261126-afbb
title: Cloud studio seams are attested under the account mix's seam key
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-library-walkthrough.md section 14
commit:
---

A seam in an account mix says 'Prepared in your cloud library.' only when its record (the mix's own seam key, from seams.request_from) has a worker attestation (cloud_brain.mixes_routes._states). The hosted session keeps its seams under their own 'w' keys (engine_store.hosted_seams.worker_seam_key), so nothing attests a mix's key today. Good looks like: when the shared player plays a cloud studio clip for a mix seam (cloud.studio_seams, web/src/cloud/cloudSeams.ts), the seam is recorded under the mix's key with a worker attestation (the clip's sha256 and length from POST /api/hosted/seams), and the mix and drafts lists then read 'Prepared in your cloud library.' for it.
