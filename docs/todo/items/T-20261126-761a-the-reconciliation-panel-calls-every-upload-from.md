---
id: T-20261126-761a
title: The reconciliation panel calls every upload from this device Matched on your device
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: ADR-0489; plan two places 6e
commit:
---

Since uploads from this device join the song they are for (storage.upload_identity, ADR-0489), every upload of a device song has the same content hash as a song on a device, so web/src/cloud/migration/ReconciliationPanel.tsx lists every such upload as Matched, with the reason 'The same audio is on your device, matched by its contents. Mixes that use it can play it from there.' That is wrong for a song now played from the cloud library only (its row left this device's list) and says nothing about where the upload came from. Good: the panel says an upload made from this device is the same song in both places, names a song played from the cloud library only as such, and keeps Matched for hosted songs that were matched to a device import. ADR-0465 BF-0465-02 carries the correction note.
