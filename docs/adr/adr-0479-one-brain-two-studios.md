# ADR-0479 - One brain, two studios: the same DJ on Desktop, in the cloud library and on the device

- **Decision:** Proposed. The plan this records was approved by the owner on 2026-11-25, with the four decisions listed below made in that conversation. The wording of this ADR, which changes promises earlier Accepted ADRs made, still needs the owner's read.
- **Implementation:** Started on branch `feat/one-brain` (cut from `main` at `f5b6a4ab`). See "What is built" at the end.
- **Independent verification:** None.
- **Programme/date/baseline:** One brain (OB); 2026-11-25; `main` at `f5b6a4ab`.
- **Existing ADR owners, narrowed or amended here:** ADR-0391 and ADR-0455 (what may change on Desktop, and what Cloud may hold), ADR-0393 and ADR-0394 (tenancy and durable jobs, extended to the engine), ADR-0405 (stem model), ADR-0418 (cloud mixing parity), ADR-0456 and ADR-0457 (the hosted plane and its player), ADR-0459 (browser tiers and honesty), ADR-0465 (device and hosted copies of one song), ADR-0469 (device results stay private). Each keeps its own status; the section "What this changes in earlier ADRs" says exactly what.
- **Research:** [transition-craft-2.md](../research/transition-craft-2.md), [browser-studio.md](../research/browser-studio.md). **Words:** [glossary.md](../glossary.md).

## The problem

SelectaDJ plays in three places, and they are not the same DJ.

| | Desktop | Cloud, song in the cloud library | Cloud, song on the device |
|---|---|---|---|
| Measures a song with | Beat This, refined grid, sections, bar-level features, key model, lyrics, vocal sensing from stems | The same analysis on a worker since 2026-11-25 (`cloud.hosted_render`), with a chroma key and no lyrics or stems | Tempo by autocorrelation on a 60 s slice, at seam time |
| Chooses the order with | Idea cards, beam search, energy arc, seam memory | The planner's order for up to 60 songs, with no memory | Alphabetical between a chosen start and end |
| Makes a transition by | 15 moves; exit, entry, move and length scored together; rendered, audited, repaired | The same render and audit on a worker, but with no vocal information every blend falls back to an echo or a cut (`docs/engineering/hosted-mode-walkthrough.md`) | Live Web Audio scripting; exits at the song's end, entries at second 0; often a 3 s fade |
| Stems | Demucs windows; vocal ride, strip and land, intertwine, studio | None (licence) | Built, can never switch on |
| Pages | The full shell | A card on Make a Mix with its own small player; no editor, Seam Inspector, Studio, requests or discovery | The full shell, with 12 features switched off |

Three things follow. The planner exists once in Python but only Desktop gets all of it. Each
Cloud case has its own mix model (`/cloud-mixes`, recipes, and now the hosted timeline) and its
own player (`useCloudPlayer.ts`, `localFirstPlayer.ts`, `hosted/timelinePlayer.ts`). And the
names collide: "local" means Desktop in some places and the device case in others.

The device case also has plain defects, traced in the code: seams are planned 45 s before a song
ends although a 16-bar blend must start up to 50 s before; a few missed worker deadlines end
beatmatching for the visit; songs are not loudness matched; the export plays no seams.

## Decisions the owner made (2026-11-25)

1. **The engine's storage is rewritten onto the shared multi-tenant database.** The alternative,
   a private copy of the Desktop engine per member, was offered and declined.
2. **Cloud stems use a commercially clean separator now** (MIT weights trained on licensed
   music). Demucs stays wired behind its licence gate until legal review clears it (ADR-0405).
3. **Song facts may be saved to the account** for songs that stay on a device: tempo, beat and
   bar positions, sections, key, loudness, per-bar energy and tone numbers, when singing
   happens. Never audio, never file paths.
4. **Scope:** this programme finishes every "not yet" in the mixing engine and its three homes.
   Every other Not started task in the repo is filed to `docs/todo`.

## Decision

### 1. One brain

The planner, cue logic, recipes, scoring, seam memory, requests and bridges, discovery and idea
cards run in Python, in one place per account: the Desktop server or the Cloud API. They work
from song facts. A browser never scores or invents a transition.

That requires a **planner core**: a package with no audio, file or database imports, pinned by
an import test, that takes facts, flags and seam memory as arguments. Today `planner/choose.py`,
`beam.py` and `vibes.py` import the renderer, `sqlite3`, `soundfile` and the stem separator.

Choosing a transition is a loop: render, audit, try the next candidate, tighten the beats. That
loop must run where the audio is. So the brain sends ranked candidates and the repair rule as
data, and the studio runs the loop. The rule (`choose._next_candidate`,
`seam_kinds.good_enough`) is a small pure function of the audit report, pinned by fixtures both
implementations must pass.

### 2. One storage layer for Desktop and Cloud

To avoid two code paths, the engine gets one storage layer that both run on.

- Relational state moves from raw `sqlite3` calls (about 183, in about 47 modules) to an
  `EngineStore` in SQLAlchemy Core, defined in the shared Alembic migrations. Desktop runs it
  on SQLite, Cloud on Postgres.
- The store requires a workspace and refuses to run without one. Engine tables get a
  fail-closed isolation policy: today's policy (`b7e3c91f0a24`) treats a transaction that names
  no workspace as a system transaction and lets it read every tenant.
- File state (features, seam clips and records, seam history, stem windows, exports) moves
  behind the existing `ArtifactStore`. Audio is reached through a `SourceResolver`, never a
  path. Caches and freshness key on content hash.
- Work goes through the durable job store. It becomes Desktop's default only after the owner's
  listening check that ADR-0394 SC-0394-04 already requires.
- Routes take a per-request context (workspace, store, artifacts, flags). Flags are read through
  a context variable bound per request or job. The Cloud API then mounts the Desktop route
  families for Cloud accounts.
- Cloud keys songs by content hash, as its catalogue does. Desktop keeps rows keyed by path and
  gains a hash filled in by a background job.
- A seam is ready when a studio has attested it (who rendered it, clip hash, audit, rules
  version), not when a file is found on disk.

### 3. Every move is a script, and two studios render it

A transition is a `TransitionScript` that one `render()` plays and one `audit()` measures. The
moves that bypass it today (studio, strip and land, intertwine) go through it. A script has a
JSON form that names songs and stem windows by id and facts version. The audit takes vocal
spans as an input.

- **Cloud studio:** the worker fleet running the full Desktop seam pipeline, with stems and
  vocal sensing, for songs in the cloud library. It builds on `cloud.hosted_render`.
- **Device studio:** the member's browser, for songs on the device. It ports only deterministic
  audio code (script renderer, DSP, audit, feature extraction, the repair rule) and runs two
  models (Beat This, the stem separator). It renders seam clips offline ahead of time, audits
  them and reports numbers. Clips stay on the device.

Device work comes through a member-scoped route, not the fleet's worker gateway: authenticated
by the member's session and device key, able to claim only its own workspace's device jobs,
declaring no stored outputs, with results schema-checked, never billed as compute, never
written to the cross-account shared store.

**Same decode rule.** A seam is played from the decode it was rendered from: a cloud clip with
the lossless prepared file, a device clip with the device's own decode. A song held both ways
uses the cloud studio.

### 4. One Cloud shell and plain names

One Cloud shell renders the Desktop pages for every Cloud account. The words are in
[glossary.md](../glossary.md): Desktop, Cloud, on this device, in your cloud library, device
studio, cloud studio, song facts. Identifiers are renamed mechanically at the end.

## What this changes in earlier ADRs

| ADR | It says | From this ADR |
|---|---|---|
| ADR-0455 (line 27), ADR-0391 | `SELECTA_MODE=local` behaviour does not change; the Desktop user notices nothing | Desktop's storage layer and job paths may change behind flags. What a Desktop user can see or hear must not get worse; the Desktop pytest and Playwright suites are the proof at every step |
| ADR-0455 | Cloud holds permitted catalogue metadata for a device-music account | Song facts are permitted account data. Audio, PCM, stems, derived audio and paths still never leave the device; `tests/test_bf_no_audio_egress.py` stays the gate |
| ADR-0469 | Client analysis is private to the workspace | Unchanged, restated: device facts and device seam reports are never written to `shared_derivations` |
| ADR-0394 SC-0394-04 | Old job paths stay until the owner's listening check | Unchanged; that check is this programme's gate for durable jobs by default |
| ADR-0456, ADR-0457 | The hosted plane is unchanged; `useCloudPlayer.ts` and `CloudListen.tsx` are the hosted player | The hosted plane gains the cloud studio, and cloud-library accounts move to the one Cloud shell and its player. Grants, uploads, quotas and stored-media reads are untouched |
| ADR-0459 | Tier 3 models need a per-device benchmark and a licence check; a lighter method is never called the same feature | Unchanged and relied on. Beat This and the stem separator in the browser switch on only with both. The device renderer carries its own implementation id; parity is measured with golden fixtures and judged by ear |
| ADR-0465 | A device copy is preferred, a hosted copy is the fallback | The same decode rule above decides which studio serves a seam |
| ADR-0405 | Demucs weights are under review; stems do not run in Cloud | A clean separator is added to the register and the allowlist; Demucs stays under review |
| ADR-0418 | Cloud mixing parity, 0/5 not started | Its contract and hosted rendering are merged; its checklist is brought up to date in this programme |

## Phases

0. This ADR, the glossary, the research notes, and every other Not started task filed to
   `docs/todo`.
1. Device quick fixes: plan each seam when its song starts, loudness gain, deadline retries.
2. One renderer on Desktop: script JSON, source resolver, stem moves through the engine.
3. Store groundwork and two slices: migrations, backup, fail-closed tenancy, flag context;
   ratings; the song read side.
4. Planner core and planning in Cloud; the device job route.
5. Device studio: whole-song analysis, script renderer and audit, stems, export.
6. Cloud studio completed on `cloud.hosted_render`: stems and vocal sensing so blends survive,
   play as parts arrive, export from the heard seams, memory and variety; one shell.
7. The rest of the engine on the shared store; Cloud mounts the Desktop routes.
8. Transition craft II (starts after phase 2): band weave, loop-made room, tonal owner, rhythm
   fit, tempo bridge, ratings calibration.
9. Renames, removals, final pass.

Each audio phase ends at a listening stop. Only the owner can judge sound.

## Edge cases

1. **A device reports wrong facts or a false audit.** It can only affect that member's own
   mixes. Reports are schema-checked and never shared.
2. **A device cannot render.** It says so once and keeps the live scripted path; nothing
   degrades silently.
3. **A song changes on disk.** Facts and clips key on content hash, so a changed file is a new
   song to the studio.
4. **Two devices of one account.** Facts made on one serve all. A device clip plays only on the
   device that holds it; another device renders its own.
5. **An unscoped read.** On Postgres it returns nothing for engine tables. A test proves it.
6. **Offline.** Planned mixes with their scripts play; a new plan waits for the connection.
7. **Lyrics.** Whether lyric timing may drive Cloud planning waits on legal advice (ADR-0406).
   Vocal spans measured from a voice stem need no lyrics, so blends do not depend on it.
8. **Flags off.** Each phase's flag off returns the surfaces to what they were.

## Not decided here

- The key model for Cloud (S-KEY is blocked; chroma disagrees on some songs): to-do T-20261125-9e2e.
- Lyrics for Cloud processing: to-do T-20261125-9d62 and ADR-0406.
- Whether Demucs may ever run in Cloud: legal review, to-do T-20261125-c77c.
- Which stretch library the device studio ships (Rubber Band WASM or Signalsmith): measured in
  phase 5.

## What is built

- 2026-11-25, `feat/one-brain`: this ADR, [glossary.md](../glossary.md), the two research notes,
  and the other programmes' Not started tasks filed to `docs/todo`.
