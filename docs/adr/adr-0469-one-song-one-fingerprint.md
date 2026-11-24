# ADR-0469 - One song, one fingerprint: account switching and derived-data reuse

- **Decision:** Proposed (agent mt for the owner, 2026-11-18).
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-18; branch `docs/browser-first-cloud-adrs` at `4f170835`.
- **Implementing PR:** #96.
- **Flags:** `cloud.content_cache` (device cache keyed by content; build-on in `BROWSER_FIRST_FLAGS`), `cloud.hosted_dedupe` (server shared derivations; default off). The per-workspace device index is a privacy and correctness fix and is not flagged.
- **Source touchpoints:** `web/src/media/store.ts`, `web/src/media/resolve.ts`, `web/src/cloud/LocalFirstShell.tsx`, `web/src/cloud/onboarding/deps.ts`, `web/src/cloud/importSession.ts`, `web/src/cloud/deviceData.ts`, `web/src/cloud/DeviceDataCard.tsx`, `web/src/cloud/CloudApp.tsx`; `src/selecta/storage/schema.py`, `src/selecta/storage/shared_derivations.py`, `src/selecta/storage/deletion.py`, migration `bf0469shared01`; `src/selecta/flags/cloud.json`.

## Context

A person may sign out and sign in to a different account in the same browser, watching the same folder or different folders. The owner's requirements: any data that can be reused for the same song is reused, even under a different title, when the fingerprint is certain; and there must be no data issues or leakage between accounts.

What this branch found before the change:

- The device song index was one IndexedDB database, `selecta-media`, shared by every account. Rows are keyed by `songId`, which is a per-workspace server id, so account B's song 12 could be answered by account A's row: A's title, A's file handle. That is both a wrong-song bug and a privacy leak.
- The OPFS derived cache was keyed `bytes-<songId>`, the same collision again, and no reuse across accounts or titles.
- The import progress snapshot is module state carrying a folder name and file names; it was not tied to a workspace.
- The remembered folder (`selecta-media-folders`) and the import marker (`selecta.import.<workspaceId>`) were already keyed by workspace.
- On the server, the metadata catalogue is `(workspace_id, content_sha256)` with per-workspace titles; hosted originals live under `w/{workspace}/a/{asset_id}`; derived artifacts are keyed `(workspace_id, kind, input_hash)` and ADR-0397 says on purpose that there is no deduplication across accounts.

## Decision

### 1. The device cache contract

- **Content-addressed.** With `cloud.content_cache` on, a song's cached bytes live at `bytes-v1-<content_sha256>`. Derived data is a pure function of the bytes, so the same file imported under another account, re-imported after signing out, or registered under another title finds the same entry.
- **Version-prefixed.** `CACHE_KEY_VERSION` (`v1`) is in every content key. A change to what is cached bumps it, so an old entry is a miss and later evicted, never misread.
- **Possession-proven.** The hash in the key is always one this device computed itself from a file it opened (the importer and the re-authorisation flow hash locally; the stored identity is never the server's reply). Writes go through `cacheSongBytes`, which hashes the bytes and refuses them unless they match. Reads go through `readSongBytes`, which re-hashes a hit and evicts it when it does not match. A server-supplied hash is never trusted to name shared bytes.
- **Flag off means nothing is shared.** Keys fall back to `bytes-<workspaceId>-<songId>`.
- **Eviction namespace unchanged.** Every key still sits under the `cache-` prefix, the only names eviction may touch; catalogue rows and source handles are never candidates.
- **What it holds today.** No production path writes song bytes into the cache: copying source files into browser storage would be the second library ADR-0458 rejects. The contract governs every reader and writer of the cache, so anything cached under it is reusable by fingerprint; the cache itself is not yet filled by a feature. The device-wide derived store (amendment 1 below) is what now carries reuse across accounts on one browser.

### 2. The account-switch contract

- **One index per workspace.** `MediaStore.open(workspaceId)` opens `selecta-media-ws-<workspaceId>`. The shell keys its open store and resolver by workspace, so a different account in the same tab opens its own index. The memory-only degraded path keeps working, still scoped.
- **Legacy disposal.** The unscoped `selecta-media` database cannot be attributed to a workspace, so the first scoped open on a page deletes it. The cost is one re-import, never music.
- **Two workspaces, one folder.** Each workspace keeps its own remembered folder entry and its own import marker. The browser's read permission for a folder is granted per site, not per account, so B picking a folder A already granted may not be prompted; B still has to pick it, and no handle or folder name crosses between workspaces.
- **Import progress.** The snapshot is keyed by the workspace that started it. `useImportSession(workspaceId)` reads another workspace's import as idle from the first render, `bindImportWorkspace` does the same for surfaces without a workspace (the announcer), and leaving the shell ends the import and forgets the snapshot, so a new account in the same tab never sees, or records against itself, the last account's summary.
- **Sign out** keeps that workspace's device data so returning is instant. While another workspace is active it is unreachable, because every index is named by workspace and the server session decides which workspace is active.
- **Delete account** wipes that workspace's song index, remembered folder, import marker, media profile id and device key before signing out.
- **This browser card** (Settings, `cloud.local_media`): "Forget this account here" does the same wipe for the signed-in workspace; "Clear everything in this browser" deletes every `selecta-media*` database, the venue offline cache, the OPFS `cache-` namespace and SelectaDJ's own `selecta.` keys in local storage, then reloads. The sign-in itself is left alone; signing out is its own button.
- **The shared content cache survives account deletion.** It is derived from bytes only, holds no titles, ratings or history, and serves every account on the device. Only "clear everything" removes it.

### 3. The sharing rule (device and server)

Data may be shared across tenants by fingerprint only when it is a deterministic machine derivation of the bytes (analysis, waveform, beat grid, cached bytes). User-entered and usage data never joins by fingerprint: titles, artists as typed, ratings, play history, mix membership. A tenant may read a shared row only for a hash it has itself proven it holds. Catalogue rows stay per workspace; the same bytes under two accounts keep each account's own title.

### 4. Cloud side

- **Shared derivations.** `shared_derivations` is keyed `(content_sha256, kind, analysis_version)` with no workspace column. It is the only table with a content hash and no `workspace_id`, and it is named as global in the workspace-columns register. Access goes only through `selecta.storage.shared_derivations`:
  - **Read rule:** `read_shared` answers only when the reading workspace holds a live `assets` row with that sha256. That hash was computed by the server from bytes the workspace uploaded, so it is possession proof. A metadata-only `local_songs` registration is a client claim and grants nothing here; browser-first members analyse on their own device and lose nothing.
  - **Write rule:** `write_shared` accepts `source` `server` (computed by the server) or `verified` (a client result re-checked against bytes the server holds), and the caller must name the asset in its own workspace holding those bytes. Unverifiable client analysis stays workspace-private. Payloads with user-entered keys are refused at any depth.
  - **No oracle:** a refused read and a missing row both answer None.
- **Hosted blob dedupe (contract, follow-up).** Real content addressing of originals would change the bucket layout ADR-0397 fixed (`w/{workspace}/a/{asset_id}`), the prefix-based account erasure, the tombstone replay after restore, the offsite ledger and quota attribution. That is too invasive for this PR and is not claimed. The contract for when it is built:
  - The client uploads the full bytes; the server hashes what it received and only then points the workspace's asset at an existing blob, discarding the duplicate upload.
  - Skip-upload-by-hash across tenants is never offered: it would confirm to one tenant that another holds a file. (The existing pre-upload duplicate check is scoped to the person's own workspace and stays.)
  - Deleting a song drops one reference; bytes leave storage only when the last reference leaves. `content_references` and `last_reference_gone` compute that count from live assets rather than keeping a counter, so a restore or tombstone replay cannot make it drift. They run in platform context and are never exposed through a route.
- **Deletion under sharing.** When a deletion's physical erasure is recorded, shared derivations for bytes no live asset still holds are dropped (`drop_unreferenced`), so erasing the last account that held a file erases what was derived from it. Over-deleting only costs a recompute.
- **No new routes.** Nothing here adds or changes an API route, so the tenant-isolation route matrix is unchanged.

### 5. Risks considered

- **Skip-upload oracle:** closed by never offering cross-tenant skip-by-hash.
- **Hash-claim read oracle:** closed by the possession rule (server-hashed asset, never a claimed hash) and by refusal looking like absence.
- **Dedupe timing side channel:** a shared hit is faster than a recompute. On the server, only a holder of the bytes can trigger a read at all, so the signal tells it no more than "someone computed this before". On the device, a cache hit tells an account that some account on this browser once cached the same file, which it can only test with the file in hand. Accepted as minor.
- **Unscoped device keys left as they are:** `selecta-now` (resume position by song id; resumes only when the id is in the current mix), `selecta.recentDraft` (a draft id read back through the signed-in account's own API, which refuses another workspace's id) and `selecta.lucy.unsent.<conversation>` (keyed by a server conversation id). None shows another account's data; each can misfire as a wrong resume pointer at worst. "Clear everything" removes them.
- **Business venue offline cache** (`selectadj-zone-cache`) is outside this ADR's keying; "clear everything" deletes it.

## Amendment 1 (2026-11-24): the device-wide derived store and the fingerprint memo

The owner's case: account A imported a folder of about 2,900 songs in a browser; account B signs in on the same browser and picks the same folder. Before this amendment B redid everything: every file hashed in full, every duration probed, every tonal profile measured again, because derived data lived per workspace and the content cache had no producer.

### What now produces and consumes shared data

With `cloud.content_cache` on, one IndexedDB database per browser, `selecta-media-derived` (`web/src/media/derived.ts`), holds:

| Kind | Key | Producer | Consumer |
|---|---|---|---|
| `facts` (duration) | `facts`, `facts-v1`, sha256 | the importer, after probing a file it hashed in that run | the importer, which skips the duration probe |
| `tonal` (tonal profile) | `tonal`, `tonal-profile-v1`, sha256 | the tonal profiler (`cloud/tonalProfiles.ts`), after the resolver proved the bytes | harmonic matches, through the workspace's own index |
| `waveform` (Listen's strip) | `waveform`, `waveform-v1-400`, sha256 | `cloud/sharedWaveforms.ts`, after hashing the bytes it decoded | the same, for a proven hash |
| fingerprint memo | a SHA-256 of `fp-v1`, the file's place, size and last-modified time | the importer, after hashing a file | the importer (the memo rule below) |

- **No workspace, no person.** Rows hold a kind, a version, a hash and the derived value. `assertMachineDerived` refuses any value carrying a key such as title, artist, name, path, rating, history, review or workspace, at any depth. The memo key is itself a hash, so the store holds no file name or path in the clear.
- **A workspace's view is its own index.** Reads take a list of hashes: the ones the signed-in workspace's own song index (`selecta-media-ws-<workspace>`) holds and has proven (`provenHashes`). There is no listing of the shared store, so an account only ever reads a derivation for a file it has opened and hashed itself.
- **Possession-proven writes.** A derivation is written only under a hash just computed from the bytes in hand: the importer's own hash, the resolver's play-time check, or a hash of the bytes about to be decoded.
- **One writer per hash.** Expensive work takes a Web Lock named for the hash (`withHashLock`, the pattern in `devices/audioTab.ts`): two tabs importing the same folder hash each file once (the second finds the memo entry), and two tabs never measure the same profile at once.
- **Migration.** Tonal profiles an older build kept in `selecta-tonal-<workspace>` are copied into the shared store lazily, on the first read with the flag on, only for hashes the workspace has proven, in the background, and never deleted from where they were. A marker in local storage stops the copy repeating. Harmonic reviews (the member's own verdicts) stay per workspace.
- **Quota.** A full store evicts the least recently used derivations, then the oldest memo entries, 25 at a time, and retries. Song indexes are separate databases and never candidates. A miss is a recompute.
- **Version bump.** Every key carries its version (and the memo its own `fp-v1`), so a new implementation reads the old entries as misses; they age out by eviction.
- **Private browsing or refused storage.** The store degrades to memory for the visit. The memo then keeps nothing at all (a hint must come from a store that outlives the page), so every file is hashed, and the import summary says nothing can be recognised next time.
- **Flag off.** No shared store and no memo: tonal profiles stay per workspace, every import hashes every file, nothing is shared.
- **Account removal.** "Forget this account here" and account deletion drop the workspace's index, its `selecta-tonal-<workspace>` database (reviews) and its fingerprint log; the shared store survives, as the content cache does (§2). "Clear everything in this browser" deletes `selecta-media-derived` with every other `selecta-media*` and `selecta-tonal-*` database.
- **Stems** already used content keys under this flag (`dsp/stems/cache.ts`), but the player plans stem windows without a content hash, so they stay scoped to the workspace. Left as they are: their source bytes can come from a hosted copy the device has not hashed.

### The memo rule

The memo is a hint, never proof.

1. Its key covers the file's place inside the folder that was picked (the folder's own name plus the relative path, the same whether the folder came from the folder picker or a folder input), its size and its last-modified time. A different size or time is always a miss. Browsers give no stable identity for a folder handle, so a folder moved elsewhere on disk still hits; that is safe because of 2 to 4.
2. A hit is trusted for registration and listing only. The song registers under the remembered hash, with the account's own tags read from its own file, and its index row is marked `fingerprint: 'remembered'`. A duration measured here before is reused as listing data.
3. Before a remembered song's bytes first play, and before any shared analysis (tonal profile, waveform) is read for it, the bytes are hashed and compared, which the resolver's play-time verification already does for handles and now also does for picked files. A match clears the mark; a mismatch marks the song changed (the existing "changed file" recovery). A remembered hash never names shared cached bytes until proven.
4. After each import a random sample of the remembered files (1%, at least 3, at most 24) is hashed again in the background. A mismatch drops that memo entry and marks the song changed.

**Risk considered: a file rewritten with the same size and the same modified time.** A tag editor told to keep timestamps, writing into existing tag padding, can do exactly this. The song then registers under its old hash, with its new tags (tags are always read fresh). Rule 3 catches it at the first play or analysis, rule 4 may catch it sooner; until then the catalogue holds a stale hash for that one song. No other account's data is exposed: the title is the account's own, and shared analysis is not read for an unproven hash. Accepted.

### What the import shows

`ImportSummary.reuse` counts songs recognised from this browser and songs analysed. The summary line adds, for example: "2,918 recognised from this browser, so nothing had to be analysed again.", or "2,900 recognised from this browser, 18 new songs analysed.", or, for a browser that has never seen them, "None of these songs had been seen in this browser before, so each one was analysed. Next time, they'll be recognised."

### How to watch the fingerprint log

1. Settings, card "What this browser keeps" (`cloud.local_media`), section "Fingerprint log (for developers)" (`cloud.content_cache`). Open it before or during an import in the same tab. Totals sit at the top (files, recognised, hashed, bytes read and not read, time spent, an estimate of time saved at this run's own hashing speed, the sample check); below, one line per file, newest first: name, hash prefix, how the hash was found and how long it took, tags, duration, tonal profile, waveform, registration.
2. In the browser console: `localStorage.setItem('selecta.debug.fingerprint', '1')`, then import. Each line is logged under `[fingerprint]`, with a summary line at the end.
3. The log lives in memory for this tab and this workspace only. It holds only the signed-in account's own file names and hash prefixes; another account's import is never shown.

## Checklist

- [x] Device song index is one IndexedDB database per workspace; callers pass the workspace. Implemented (66506d6b)
- [x] Legacy unscoped `selecta-media` database is deleted on first scoped open. Implemented (66506d6b)
- [x] Degraded memory-only index still works, scoped to its workspace. Implemented (66506d6b)
- [x] Cache keys are `bytes-v1-<sha256>` with `cloud.content_cache` on, `bytes-<workspaceId>-<songId>` off. Implemented (66506d6b)
- [x] Content-keyed writes and reads are hash-verified against local bytes. Implemented (66506d6b)
- [x] Import progress never shows another workspace's import. Implemented (66506d6b)
- [x] Delete account wipes the workspace's index, folder and marker. Implemented (66506d6b)
- [x] Forget this account here, and clear everything in this browser, behind `cloud.local_media`. Implemented (66506d6b)
- [x] `cloud.content_cache` registered and build-on; `cloud.hosted_dedupe` registered, default off; `docs/flags.md` regenerated. Implemented (66506d6b, f66ce2c4)
- [x] Server `shared_derivations` with possession-gated reads, verified writes, user-data refusal and no oracle. Implemented (f66ce2c4)
- [x] Reference count derived from live assets; shared rows dropped when the last holder is erased. Implemented (f66ce2c4)
- [x] A failed open is a lapse (permission only on NotAllowedError, otherwise missing), never a changed file; only a verified byte mismatch is changed. Implemented (d415b878)
- [x] Play-time verification hashes without freezing the page (WebCrypto, else sliced). Implemented (d415b878)
- [x] A plain import does not invalidate the lapsed sweep, and concurrent sweeps share one run. Implemented (d415b878)
- [ ] Hosted originals stored content-addressed with refcounted erasure. Needs follow-up (contract above; ADR-0397 layout change)
- [ ] A producer that writes server analysis into `shared_derivations`. Needs follow-up (no hosted analysis job writes it today)
- [x] Guard test `tests/test_fingerprint_sharing_guard.py`: every table with a content hash and no `workspace_id` is allowlisted with the possession rule beside it, and allowlisted tables carry no user-entered columns. Implemented (8af7c9cf)
- [x] Vitest `web/src/media/accountSwitch.test.ts` and `web/src/media/lapseHonesty.test.ts`: two workspaces do not bleed, legacy database dropped, forget and clear-everything wipe, import snapshot scoped and forgotten, content cache hit across workspaces and titles, flag-off keys, hash-verified writes and reads, honest lapse reasons, one shared sweep. Implemented (8af7c9cf)
- [x] Amendment 1: device-wide derived store keyed `(kind, version, sha256)`, no workspace or user data, possession-proven writes, LRU eviction that never touches an index. Implemented (amendment 1 commits)
- [x] Amendment 1: tonal profiles, waveforms and durations produced into and read from the shared store through the workspace's proven hashes; older per-workspace profiles migrated lazily and kept. Implemented (amendment 1 commits)
- [x] Amendment 1: fingerprint memo with the memo rule (hint for listing, proven before play or shared reads, background sample check). Implemented (amendment 1 commits)
- [x] Amendment 1: import summary says what was recognised; fingerprint log in Settings and under `[fingerprint]` in the console. Implemented (amendment 1 commits)
- [ ] Amendment 1: Vitest for the derived store, the memo rule and the reuse words. Needs follow-up (features first; tests in a later pass)
- [x] Pytest `tests/test_shared_derivations.py`: possession-gated reads, claimed hashes refused, refusal equals absence, verified writes only, user data refused, flag off, reference count, erasure drops rows. Implemented (8af7c9cf; PostgreSQL variants run where a PostgreSQL test database is configured)
