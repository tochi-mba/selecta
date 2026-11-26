---
id: T-20261126-22db
title: Add music's uploads and the upload plan route do not ask for the rights statement
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: ADR-0489; owner decision 2026-11-26 (rights statement before a personal account's first upload)
commit:
---

The upload rights statement is asked by the Upload to your cloud library sheet and the device upload queue (cloud.move_to_cloud) refuses to start without it, but Add music's own uploads (web/src/cloud/Uploads.tsx) never ask, and POST /api/uploads/plan does not check it. Good: a personal workspace's first upload from any path asks for the statement once, and the plan route refuses (403 upload_rights_required) a workspace that is not a business and has not confirmed the current wording, behind the flag.
