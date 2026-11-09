*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 5. Storage, uploads and playback

### 5.1 Buckets and keys (Cloudflare R2, EU jurisdiction)

| Bucket | Contents | Lifecycle |
|---|---|---|
| `sel-originals` | User uploads after acceptance: `w/{workspace}/a/{asset_id}` | Never auto-deleted; deleted only by deletion workflow |
| `sel-derived` | Features, playback proxies, stems, seam clips, waveforms: `w/{workspace}/{kind}/{key}/attempts/{attempt}/…` | Evictable under per-workspace budgets (LRU, protected if referenced by a playing/frozen revision) |
| `sel-exports` | User exports: `w/{workspace}/x/{export_id}.flac` | Expire per plan (7/30/90 days); counted against storage while kept |
| `sel-staging` | In-progress uploads: `s/{upload_session}/…` | Abort incomplete multipart after 1 day; delete objects after 2 days |

Rules: object keys never contain filenames or user text; all buckets private (no public access, no r2.dev); reads and writes only through short-lived presigned URLs (≤ 15 min, single object), handed to browsers per action and to workers per claimed attempt, so no browser or worker ever holds a bucket credential; only the API, gateway and maintenance services hold R2 keys. R2's EU jurisdiction keeps data in the EU (fine under UK GDPR, which recognises EU adequacy). R2 is strongly consistent: a completed write is immediately readable everywhere, so the database never points at an object that "isn't there yet".

**Bucket CORS**: only the app's origin may `PUT` (staging bucket, exposing `ETag`) or `GET` (originals, derived and exports buckets, for playback and downloads). Allow `Range` requests and expose `Accept-Ranges`, `Content-Length`, `Content-Range` and `ETag` for browser audio seeking. Presigned URLs work only on R2's S3 endpoint, not on custom domains, so that endpoint is the one in the CORS rules and the CSP.

**System-managed data budget**: each workspace's derived data (features, playback files, stems, clips, waveforms) is capped at about 15% of its plan storage and evicted least-recently-used, except anything a playing or frozen revision references. Evicted items are regenerated on demand, which costs compute and egress, so eviction is tuned from beta measurements.

### 5.2 Upload protocol (always multipart, server completes)

Because R2 can't enforce size in a presigned policy, the server controls the one step that matters: completion.

1. **Select**: user drops files or a folder; the browser reads names, sizes and types only. A web worker computes a SHA-256 per file in the background for duplicate detection within the account (optional, can be skipped for speed).
2. **Plan**: `POST /uploads/sessions` with up to 500 files per batch `{name, size, type, sha256?}`. In one transaction the server checks plan limits (file size, duration cap later, daily caps), **reserves bytes** against the quota (`storage_reservations`), flags duplicates ("you already have this song: skip / keep both"), creates an upload session per file, and creates the R2 multipart upload in staging.
3. **Transfer**: the browser (Uppy's S3 multipart plugin pointed at R2's S3 endpoint) asks for presigned `UploadPart` URLs in batches, uploads parts (8 MiB, 3–4 in parallel per file, 2–3 files at a time), and can resume after refresh using the stored session (Uppy lists already-uploaded parts). R2's rules shape this: parts are 5 MiB to 5 GiB, at most 10,000 per upload, and **every part except the last must be the same size** (checked when the upload is completed), so the client uses one fixed part size per file; a 1 GB file is 128 parts. A file smaller than one part is a single-part upload.
4. **Finish**: `POST /uploads/sessions/{id}/complete`. The **server** calls `ListParts` (reading every page), checks the parts' total exactly equals the declared, reserved size and that part sizes follow the rule above, then calls `CompleteMultipartUpload` itself. Oversize or mismatched uploads are aborted and the reservation released. Because the server completes, the browser never needs to read part `ETag`s, but the bucket exposes them for Uppy's resume.
5. **Accept**: `ingest.validate` runs in a sandboxed worker: ffprobe with strict limits, real format check (not extension), duration and channel/sample-rate sanity, decode test of the first and last minute, tag parsing with length limits and Unicode normalisation, full SHA-256. Valid → server-side copy into `sel-originals` (`CopyObject`; plan file limits stay under its 5 GB single-copy limit) and delete the staging object, create `assets` + `songs` rows, convert the reservation into committed usage, enqueue analysis. Playback files are made later, only when needed ([§5.8](#58-playback-in-the-cloud-a-real-design-problem)). Invalid → delete, release reservation, show the reason.
6. **Idempotency**: every step is keyed by the session id; repeating "complete" returns the same outcome; a lost response is recovered by polling the session.

#### Current API implementation

Cloud mode exposes `POST /api/uploads/plan`, `GET /api/uploads`,
`GET /api/uploads/{session_id}`, `POST /api/uploads/{session_id}/parts`,
`POST /api/uploads/{session_id}/complete`, and `DELETE /api/uploads/{session_id}`. Every session
lookup is scoped to the authenticated workspace. Planning applies server-side plan limits, reserves
quota atomically, and detects duplicate and in-flight hashes. The Cloud UI hashes selected files in
chunks, uploads parts directly to R2, and can resume by reselecting the same file after refresh.

The API completes the multipart object itself, downloads it to temporary disk for a Mutagen format
and metadata probe, then verifies the copied original's byte count and checksum before accepting
the asset and committing the reservation. This first slice rejects unsupported formats and
duration/metadata problems, but it does not yet run a decode test or isolate hostile media parsing
in a constrained worker. The workspace-scoped asset API exposes `GET /api/assets` with cursor
pagination, `GET /api/assets/{asset_id}`, and `DELETE /api/assets/{asset_id}`. Delete hides the
asset immediately and releases quota while recording physical deletion for retention handling. The
Cloud API also exposes `GET /api/assets/{asset_id}/playback-url` for an owner-checked original and
`POST /api/storage/derived-playback-url` for a workspace-owned derived key. Both check R2 object
existence before returning a short-lived URL; original delivery also checks stored size and SHA-256
metadata and can set attachment disposition. The Cloud library can request a signed URL and play an
original track in a native audio control; on a media load error it requests one replacement URL and
restores the playhead and playing state. It does not yet assemble mixes or create lossless playback
proxies, and accepted asset rows are not yet playable song records. R2 credentials are read from
`SELECTA_R2_ACCOUNT_ID`, `SELECTA_R2_ACCESS_KEY_ID`, `SELECTA_R2_SECRET_ACCESS_KEY`, and optional
`SELECTA_R2_JURISDICTION` / bucket-name variables. The staging bucket CORS policy must allow the
Cloud web origin to `PUT` signed parts.

### 5.3 Quota accounting

- `usage = committed_bytes + active_reservations`; a new reservation succeeds only if `usage + size ≤ limit`, checked in the same transaction with a row lock on the workspace's quota row, so 1,000 parallel uploads can't oversubscribe the last gigabyte.
- Reservations expire with their session (2 days) and are released by the maintenance leader.
- A nightly reconciler compares Postgres totals with an R2 inventory listing and reports drift; it never silently "fixes" by deleting.
- Deleting a song releases its bytes as soon as the deletion is recorded (the song is hidden and unusable at once). The copy Selecta keeps for the 30-day recovery window ([§5.5](#55-deletion)) is Selecta's cost, not the user's quota.

### 5.4 Over quota (downgrades and expired subscriptions)

Never delete music because of a plan change. When usage exceeds the plan: state `over_quota_read_only`: browse, play, make mixes from existing songs, download originals, delete songs: allowed. Upload, new exports, and other storage-growing actions: blocked with a clear "you're 35 GB over Free's 10 GB" banner and two buttons (manage storage, upgrade). If an account stays over quota for 12 months after a cancelled subscription, follow the published retention policy: emails at 30, 60 and 7 days before any deletion, an export link, then deletion via the normal workflow. The policy is in the terms from day one and never changed retroactively.

### 5.5 Deletion

Deletion is a workflow, not a `DELETE`: mark tombstone (the song disappears and its quota is released immediately) → cancel jobs → remove from mixes per policy (old frozen revisions keep a "song deleted" placeholder rather than silently changing) → after a 30-day recovery window, delete objects in bounded batches, then the backup copy → confirm → audit. Tombstone creation and physical/backup completion append to a transactional mirror outbox. `selecta account-deletion-maintenance` advances account deletion steps, deletes the WorkOS identity before erasing the local user, and writes account-plan snapshots to a dedicated private R2 bucket; `selecta storage-maintenance` mirrors pending song/account/export tombstones before draining due physical deletions, and marks completion only after all R2 targets delete successfully. Both commands need scheduling. Support can restore a song within the window; after it, deletion is final. `selecta replay-deletions-after-restore` reapplies offsite storage/account records before restored traffic reopens; a restore drill remains required ([§12.4](12-security-privacy-legal.md#124-data-lifecycle)).

### 5.6 No cross-account deduplication

Identical files uploaded by two users are stored and analysed twice. Storage is cheap; cross-tenant dedupe creates an existence side channel (upload timing reveals whether someone else has a file) and complicates deletion and copyright handling. Within one account, duplicates are detected and the user chooses.

### 5.7 Downloads

Originals and exports download through presigned GETs with `Content-Disposition: attachment` and the user's filename, generated per click (TTL 5 min), rate-limited per account. Signed URLs never appear in logs or analytics.

### 5.8 Playback in the cloud (a real design problem)

Today the browser receives whole songs decoded to WAV by the server, which keeps sample-accurate alignment with seam clips because the same ffmpeg decode produced both. Over the internet:

- **Lossy formats shift samples.** MP3 and AAC add encoder delay and padding; browsers handle gapless metadata inconsistently, so a 25 ms offset can wreck a beat-matched hand-off.
- **Decision (v1)**: a **lossless FLAC playback file** per song, made from the exact PCM the analysis used (same decoder, same sample rate). Seam clips are already FLAC. The player decodes them with `decodeAudioData` as now, but fetches them cross-origin from R2 with presigned URLs (CORS allowlist for the app origin) and loads one song ahead.
- **Made lazily, not at upload.** A FLAC copy of an MP3 is about six times its size (≈25 MB vs ≈4 MB for 4 minutes), so making one for every song would turn a full 100 GB MP3 library into roughly 600 GB of playback files and the same in worker upload traffic. Instead `play.proxy` runs when a song enters a mix revision, a preview or a request, inherits that work's urgency, and lands in the evictable derived budget ([§5.1](#51-buckets-and-keys-cloudflare-r2-eu-jurisdiction)). Originals that are already lossless at the analysis sample rate (44.1 kHz stereo FLAC or WAV) are played directly and get no copy.
- **Cost**: about 375 MB of download per hour of listening. R2 egress is free, so it's a user-bandwidth question, not a Selecta cost. Show a "data use" note on mobile.
- **v2 (after beta)**: play only the sections a mix uses (each mix plays a slice of each song between seams): render per-revision segment files or use range requests with a streaming FLAC decoder, cutting transfer by ~40–60%.
- **Signed URL expiry during playback**: the player requests fresh URLs per song just before fetch; a 403 triggers one refresh-and-retry, never a mix change.
- **Two tabs / two devices**: keep today's single-tab rule per browser (`BroadcastChannel`); across devices, one device holds the playback lease and the others are remotes ([§11A.1](11a-devices-and-rooms.md#11a1-devices-and-the-playback-session)).

---

[← 04-queue-and-scheduling.md](04-queue-and-scheduling.md) · [Contents](README.md#chapters) · [06-data-model.md →](06-data-model.md)
