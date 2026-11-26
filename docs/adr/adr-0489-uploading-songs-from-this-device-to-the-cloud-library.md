# ADR-0489 - Uploading songs from this device to the cloud library

- **Decision:** Proposed. The owner made the decisions below on 2026-11-26; accepting this record is the owner's call. The rights statement's wording is Accepted (owner, 2026-11-26).
- **Implementation:** 3/7 Implemented; 4/7 In progress; 0/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Cloud with music in two places, phase 6; 2026-11-26; branches `feat/cloud-two-places` (PR #169, merged) and `feat/cloud-two-places-2`.
- **Priority / phase:** P1 / phase 6 of the plan. **Owner:** Unassigned. **Implementing PR/SHA:** #169.
- **Existing ADR owners:** ADR-0455 (no audio egress for device music), ADR-0456 (the cloud library grant), ADR-0457 (browser audio runtime), ADR-0458 (import and track identity), ADR-0465 (hosted coexistence), ADR-0479 (one brain, two studios), ADR-0449 (the business upload attestation), ADR-0412 (retention). Their statuses are unchanged; the table below says how this record narrows each.
- **Source touchpoints:** `src/selecta/storage/personal_rights.py`, `src/selecta/storage/rights_schema.py`, migration `st0480rights01`; `src/selecta/storage/upload_preview.py` and `upload_identity.py` (phase 6a); `web/src/cloud/uploadConsent.ts`, `UploadToCloudSheet.tsx`, `uploadEntry.tsx`; `web/src/cloud/cloudUploadQueue.ts`, `cloudUploadJournal.ts`, `cloudOnly.ts`; `web/src/media/folderCheck.ts`; `web/src/copy.ts`.
- **Flag:** `cloud.move_to_cloud`, on in the build. It needs `cloud.hosted_media` (the grant), `cloud.uploads` and `storage.upload_identity`, so it reaches only accounts with a cloud library.

## Context and evidence boundary

An account can hold songs on its devices and in its cloud library. Nothing let a member put a device song into the cloud library: they had to find the file again and use Add music, which made a new-looking song with none of the old one's measurements, mixes or ratings.

ADR-0455 promised that music on the member's devices never leaves them, and the Cloud words say "never moved or changed". Both stay true for every account without the grant, word for word.

This record describes code on the branch, checked by unit and route tests. It has not been walked in a browser with a real library.

## Owner decisions (2026-11-26)

- **What "moving" means.** The file on disk is never touched. Once the upload is verified, the song plays from the cloud library everywhere and leaves this device's list, and folder checks never add it back. Each song has "Play from this device again".
- **Member words.** "Upload to your cloud library", then "Play it from your cloud library only". Never "Move": the file does not move, and "never moved or changed" stays true.
- **Rights statement.** One statement before a personal account's first upload, recorded with its date and wording version. The owner approved the wording as written on 2026-11-26 ("just use it, I approve"); it is final, not a draft, and does not wait for a lawyer's reading.
- **Who gets it.** Every account with the cloud library. It is not limited to staff.

## Decision

1. **The egress exception, for granted accounts only.** A member with the cloud library grant may choose to upload songs from this device. Nothing uploads without that choice, made in the sheet below. An account without the grant cannot preview, plan or upload, and sees none of the upload words: the routes answer 403 `flag_off` (`tests/test_bf_no_audio_egress.py`), and every entry point and changed sentence is behind `cloud.move_to_cloud`.
2. **The rights statement.** Every personal workspace confirms, once, before its first upload by any path (the sheet or Add music), "I own these files or have the right to store copies of them for my own use. I understand SelectaDJ keeps them privately for my account." `GET /api/uploads/rights` says whether the current wording is confirmed; `POST /api/uploads/rights` confirms it, naming the version and the wording's SHA-256 it showed. Each confirmation keeps the version (`2026-11-26`), the hash, who confirmed it and when (`upload_rights`, fail-closed workspace policy). A new wording is a new version, and every workspace confirms again. `POST /api/uploads/plan` refuses a personal workspace that has not confirmed the current wording (409 `rights_needed`, with the words to show), and Add music turns that into the statement, so no upload path skips it; the dry run does not wait, since it sends no audio. A business workspace keeps its own per-batch statement (ADR-0449) and is never asked this one; a team workspace is not asked. The account export carries the confirmations in `settings.json`; account deletion removes them with the workspace's other rows. The wording is the owner's, approved as written on 2026-11-26; a change of one word is a new version.
3. **One sheet before every batch.** "Upload to your cloud library" shows what the batch would do before anything is sent (the dry run, `POST /api/uploads/preview`): the songs and their size, what fits in the space left (the first song that does not fit stops the rest), what is already in the cloud library, what is refused and why (too big, too long, a kind of file uploads do not take such as WMA, a file that is no longer the song), songs over 30 minutes (they upload and play, but mixes made in the cloud library leave them out), and how many days measuring takes under the plan's daily cap. It shows the statement with "I agree" when the current wording is not confirmed, and the choice "Play these from your cloud library only" (the default) or "Keep playing them from this device too". Upload is disabled until the statement is confirmed; the queue checks again (`hasUploadConsent`) and refuses to start without it.
4. **No new song identity.** An upload names the song it is for; a file whose hash is not one of that song's hashes is refused (`song_mismatch`), and acceptance checks again. The upload joins that same song, so its measurements, corrections, mixes, drafts, requests and ratings stay with it (phase 6a).
5. **Cloud only after verification, and never deleting a member's file.** Only once the server accepted the upload and returned the expected song id does this device stop listing the song: `MediaStore.remove` takes its row out of this device's index, an `in_cloud_only` record keeps the row, handle and folder places, and a fresh availability report goes to the account. The file on disk is never opened for writing, moved or deleted, and `stopWatching(..., removeSongs)` is never used.
6. **Exclusions.** Folder checks skip an excluded file that is unchanged. A changed file that is still the same song (by audio id) stays out and is noted as a newer copy; a different song imports as usual.
7. **Undo.** "Play from this device again" puts the row back from its record, and asks for the file when it has moved.

## How this narrows older records

| Record | What changes |
|---|---|
| ADR-0455 | Its no-audio-egress rule keeps holding for every account without the grant. With the grant, a member may choose to upload a device song; the choice, the sheet and the statement are the only way. |
| ADR-0457 | A song played from the cloud library only plays on this device from the cloud library, through the cloud library resolver, not from its file. |
| ADR-0458 | An upload of a device song is the same catalogue song, not a new one. An `in_cloud_only` record keeps a song off this device's list, and folder checks honour it. |
| ADR-0465 | Its reconciliation panel (BF-0465-02) matches uploads to device songs by content hash. Uploads from this device always match, so the panel now calls every such upload "Matched" on your device, which is wrong for a song played from the cloud library only (to-do T-20261126-761a). |

## User outcome and acceptance contract

A member with a cloud library picks songs on this device, or everything, and presses "Upload to your cloud library". The sheet says what will happen, asks once for the statement, and asks whether to keep playing them from this device. The songs upload in the background, play on all their devices, keep everything they had, and their files stay exactly where they were.

## Rejected alternatives

- "Move" in any member words: the file never moves.
- Deleting or changing the file after upload: the member's files are never touched.
- Asking for the statement with every batch: once per wording is enough for a personal library; a business attests per batch for its own reasons (ADR-0449).
- Limiting uploads to staff until the wording was signed: the owner approved the wording and chose every account with the cloud library, so the flag has no targeting rule of its own; its requirements keep it away from accounts without the grant.
- Waiting for a lawyer to read the statement: the owner approved it as written.

## Implementation checklist - 3/7 Implemented; 0/7 independently Verified

1. **TP-0489-01 - The rights statement on the server.** **Acceptance:** Kept per workspace with version, hash, who and when; a new wording asks again; business workspaces are not asked; a first upload plan waits for it and Add music shows it once; export and deletion include it; tenant-scoped; refused without the grant. **Implementation:** Implemented; `storage/personal_rights.py`, `storage/rights_schema.py`, migration `st0480rights01`, the plan route's 409 `rights_needed`, `web/src/cloud/RightsStatement.tsx` on Add music, the account export. **Evidence:** `tests/test_cloud_upload_rights.py`, `tests/test_cloud_migrations.py`, the tenant matrix. **Independently Verified:** No.
2. **TP-0489-02 - The dry run.** **Implementation:** Implemented in phase 6a (`storage/upload_preview.py`). **Independently Verified:** No.
3. **TP-0489-03 - The sheet.** **Acceptance:** Preview, statement, the two choices, start with `keepHere`, nothing starts without the statement; keyboard, screen reader and a 390px phone. **Implementation:** Implemented; `web/src/cloud/UploadToCloudSheet.tsx`. Needs a person: a browser walk at 390px and 1920px. **Evidence:** `web/src/cloud/UploadToCloudSheet.test.tsx`. **Independently Verified:** No.
4. **TP-0489-04 - Entry points.** **Implementation:** In progress; Workspace > Sources "Upload everything on this device" is wired; `uploadActionsFor`, `UploadSongsButton` and `songUploadActions` are ready for the Library's selection bar, its On this device list and the song details' upload slot. **Independently Verified:** No.
5. **TP-0489-05 - The upload queue and cloud only.** **Implementation:** In progress (`cloudUploadQueue.ts`, `cloudUploadJournal.ts`, `cloudOnly.ts`). **Independently Verified:** No.
6. **TP-0489-06 - Words for granted accounts.** **Acceptance:** Each changed line signed off by the owner; accounts without the grant keep every word. **Implementation:** In progress; built behind the flag, awaiting the owner's sign-off of each line. **Evidence:** `web/src/copy.test.ts`. **Independently Verified:** No.
7. **TP-0489-07 - The browser test.** **Acceptance:** `web/e2e-cloud/upload-to-cloud.cloud.ts` on desktop and on a phone, with the choose-again path. **Implementation:** In progress. **Independently Verified:** No.

## Governance

Proposed on 2026-11-26 from the plan "Cloud with music in two places", whose phase 6 the owner approved. Older records keep their statuses; ADR-0455, 0457, 0458 and 0465 carry a pointer here.
