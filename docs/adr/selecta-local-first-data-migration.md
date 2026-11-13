# LF data model, recipe compatibility and media sunset

**Status:** Accepted design; no migrations executed. **Owners:** ADR-0458-0460,0465,0480.

## Data location and schema

| Cloud metadata / configuration | Local authoritative state |
|---|---|
| `catalogue_tracks`: workspace ID, track ID, opt-in basic metadata | `local_sources`: private filesystem root, source identity, permissions |
| `mixes`, `mix_revisions`, `mix_track_occurrences`, `transition_specs` | `local_media`: actual paths, hashes, format, file revision |
| `devices`, `device_capabilities`, short-lived `device_media_availability` | `track_bindings`: canonical IDs to verified recordings |
| `playback_sessions`, `device_commands`, ACKs | `local_analysis`, `local_artifacts`, local job attempts |
| `workspace_catalogues`, collection/crate refs, venue programmes | `playback_checkpoints`, committed/seam horizon |
| Staff, orgs, grants, subscriptions, AI use, audit | `local_outbox`, play journal, offline permit/policy |
| Scoped play logs and privacy-safe device health | Selected output, local source permissions, cache and export paths |

The final schema must use existing models where safe; these are logical entities, not an instruction to create duplicate physical tables blindly. All tenant-owned cloud rows retain row-level security and server-authorised access.

## Canonical identity and equivalence

- A canonical track ID is random/workspace-scoped and independent of filename, path, R2 key, global SHA or ISRC.
- A **track occurrence** in a mix has its own stable identity even if a song is repeated.
- Verified equivalent recording is stronger than artist/title or ISRC match, but weaker than guaranteed transition compatibility. The agent checks audio timebase, intro/outro alignment, beat grid and any user cue before using saved renders.
- Local exact hashes/fingerprints stay local by default; any remote identity matching needs a privacy threat model.
- Device availability is materialised minimally, permission-scoped and freshness-bounded; unknown is not missing and stale is not Ready.

## Migration flow

1. Snapshot existing schema, asset table, R2 objects, backups, billing plan versions and protected virtual `mix_revision` artifacts.
2. Add canonical track IDs and versioned recipe documents alongside current virtual artifacts; preserve entire revision DAG and old hashes for diagnostics.
3. Build old asset ID -> canonical reference mapping without inventing matches. Mismatches become unresolved references with an accessible repair flow.
4. Register a user's local engine and let it verify its private files against the catalogue, opt-in to permitted metadata. No file upload.
5. Enable cloud recipe API read from both shapes; write new shape on versioned clients; prove edits/restore before switching defaults.
6. Migrate business organisation library to metadata catalogue and separate per-venue device inventories. Never infer that an HQ recipe is playable.
7. Implement metadata-only `/api/account/export` and local export separately; retain appropriate retrieval of pre-existing hosted assets during a reviewed customer transition.
8. Close legacy uploads, perform no-cloud-audio audit, settle retention, then retire R2 backups, media tables/columns and secrets with proven rollback/restore procedures.

## Constraints

Local originals are never removed by deleting a catalogue row, disconnecting folder, unlinking cloud account or clearing cached analysis. User-selected exports live where user saved them. Retire old cloud files only under the agreed customer/retention plan.

## Hard migration tests

- Existing 0418 virtual revisions are still readable, editable and restorably ordered.
- Track missing on new device remains represented in cloud; no deletion or fake match.
- Clean edit is not silently replaced with explicit master; live recording is not treated as radio edit.
- Replaying schema/backfill after interruption is idempotent.
- Two offline edits to the same seam produce conflict; disjoint metadata fields can merge safely.
- A restore cannot resurrect forbidden audio-upload routes or silently publish R2 originals.
- Account export and delete distinguish cloud metadata from local media and preserve tenancy.
