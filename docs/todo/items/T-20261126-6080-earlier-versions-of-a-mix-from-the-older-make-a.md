---
id: T-20261126-6080
title: Earlier versions of a mix from the older Make a Mix page have no place in the one shell
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: two-places plan phase 8 (cloud.one_shell), the older pages compared in docs/engineering/cloud-library-walkthrough.md section 15
commit:
---

The older Make a Mix page (web/src/cloud/MakeCloudMix.tsx, /cloud-mixes) keeps every saved version of a mix and offers Restore version. With cloud.one_shell, a cloud-only account reaches its mixes through My Mixes, where cloud.account_mixes brings each /cloud-mixes mix in once as a draft, latest version only (engine_store.mix_import.import_cloud_mixes); the earlier versions stay on the server and nothing in the one shell lists or restores them. Good looks like: a draft that came from a Cloud mix offers its earlier versions in the editor or My Mixes (read from /cloud-mixes/{id} versions, restored as a new revision of the draft), or the import brings each version in as a draft revision, so nothing on the older page is lost when it is removed (T-20261126-fefe).
