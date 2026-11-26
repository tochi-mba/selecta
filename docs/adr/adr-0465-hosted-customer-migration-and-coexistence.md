# ADR-0465 - Hosted customer migration and coexistence

> Words: this record keeps the names of its time; [glossary.md](../glossary.md) says what each is called now (ADR-0479).

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 5/6 implemented in code; 0/6 in progress; 1/6 not started. Required regression and seeded integration tests plus real hosted-account evidence remain pending.
- **Independent verification:** 0/6 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF5. **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0412 (retention): unchanged and binding. ADR-0398 (uploads), ADR-0399 (proxies): unchanged, hosted mode. ADR-0414 (targeting): unchanged, supplies the grandfather rule. Sibling BF ADRs: ADR-0456, ADR-0458, ADR-0464, ADR-0467.
- **Source touchpoints:** `src/selecta/flags/rules.py` (the grandfather rule); `src/selecta/routes/cloud_export.py` (`account.data_export`, originals export); `src/selecta/storage/deletion.py` and the deletion ledger (unchanged, relied on); new migration helpers in `web/src/media/` (import with identity matching, ADR-0458); `src/selecta/playback/` (playback precedence).
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md).

## Context and evidence boundary

When `cloud.local_first` becomes the default (ADR-0467), every account that ever completed an upload must notice nothing: that is the owner's decision of 2026-11-17, implemented as one ADR-0414 targeting rule granting `cloud.hosted_media` to that population before the default flips. Also decided: the grant's absence gates new uploads and processing only, so stored media plays regardless (ADR-0456), and nothing forces anyone to migrate, ever.

What needs design is the voluntary path from hosted to local-first and the shape of an account that holds both. The pieces exist separately: `account.data_export` zips originals from R2; ADR-0458 gives import with content-hash identity, so re-imported originals resolve to the tracks that recipes already reference. Recipe revisions are metadata and survive either way. No migration tooling exists on `main`; nothing below is implemented.

## Decision

- **Grandfather by one rule, before the flip.** A single auditable targeting rule grants `cloud.hosted_media` to every account with at least one completed upload, created and verified before `cloud.local_first` defaults on. The rule is enumerable (the admin page shows who and why) and its population only shrinks, by members choosing to leave hosted behind, never by revocation this programme performs.
- **Migration is opt-in, reversible in spirit, and never destructive.** The voluntary path: export originals (the existing archive), re-import locally on the member's device (ADR-0458), identity matching reattaches every recipe reference that resolves, and the member sees a truthful reconciliation (matched, unmatched, why). Stored originals stay in R2 untouched by migration; deletion remains a separate, existing, member-initiated act under ADR-0412 retention and the deletion ledger. No BF task deletes media.
- **Coexistence is first-class.** An account may hold both modes indefinitely: hosted uploads playable through the hosted player, local tracks through the runtime. Precedence is by explicit member choice of playing device and source, with one rule where ambiguity exists: a playback session's programme resolves each track on the playing device first (ADR-0458 availability), falling back to the hosted proxy where the device lacks the file and the account holds the grant. The session never silently mixes sources mid-seam without the capability record saying both paths are seam-safe.
- **Communication is calm.** Grandfathered members get one plain notice at cutover: nothing changed for you, here is what the new default means, here is the voluntary path if you ever want it. No countdown, no deprecation banner, no migration pressure in onboarding (ADR-0463) or billing (ADR-0464).
- **Rollback.** If the flip misbehaves, `cloud.local_first` reverts to off by flag change alone; the grandfather rule is independent of the flip and keeps hosted accounts working throughout either direction.

## User outcome and acceptance contract

A member who has uploaded for a year keeps exactly their product on flag day, learns in one notice that nothing changed, and can at any time pull their originals down, re-import them locally, and find every mix intact because the tracks matched by content. A member who tries migration and dislikes it has lost nothing: the hosted library is still there.

## Edge cases

- **Partial local coverage after migration.** A member re-imports on a laptop that holds 60% of the exported originals: reconciliation lists the rest as hosted-only; recipes spanning both still open, resolving per the precedence rule.
- **Identity mismatch.** An original whose re-downloaded bytes hash differently from a member's local copy of the same song (different encoding) does not silently merge: both entries exist with the duplicate marker (ADR-0458), and reconciliation explains which one each recipe references.
- **The grandfather rule misses someone.** An account that uploaded and lacks the grant at flip: the detection query, the rule and an admin remedy path are all auditable; the member-visible symptom (upload surface vanished) has a support runbook entry.
- **A grandfathered account that never uploads again.** Stays grandfathered; the rule does not expire people for inactivity.
- **Workspace members versus owners.** The grant is account or workspace scoped exactly as rules allow; a workspace's members inherit the workspace's grant; leaving the workspace loses it with the stored-media playability unchanged.
- **Export of a huge library.** The archive path already streams; migration guidance sets expectations for multi-day, resumable local re-import on large libraries rather than promising one magic afternoon.

## Rejected alternatives

- **Automatic server-side migration** (Cloud pushing originals to devices): Cloud deciding to move audio onto member hardware inverts consent and breaks on storage limits; members pull, Cloud never pushes.
- **Expiring the grandfather grant** after a migration window: creates the forced migration the owner rejected; the population shrinking naturally is the plan.
- **Merging hosted and local catalogues by metadata alone.** Title-and-artist matching lies constantly; identity is content hash or nothing (ADR-0458).
- **Deprecation messaging.** Pressure now would spend trust to hurry a population whose cost (ADR-0464) is a few dollars a month in storage; calm costs nothing.

## Implementation checklist - 5/6 implemented in code; 0/6 in progress; 1/6 not started; 0/6 independently Verified

1. **BF-0465-01 - Grandfather rule and audit.** **Acceptance:** The detection query (accounts with a completed upload), the rule creation, and an admin view of the population with reasons; rule verified against a seeded mixed population; created-before-flip ordering enforced in the ADR-0467 runbook. **Required verification:** `tests/test_cloud_flag_rules*.py` extensions, seeded-population test. **Implementation:** Implemented in `src/selecta/hosted_coexistence/grandfather.py`, the admin audit endpoint, `docs/operations/bf-rollout-runbook.md` and `src/selecta/flags/flip_guard.py`. The seeded-population, admin-audit and flip-order regression tests are pending the final test phase. **Independently Verified:** No.
2. **BF-0465-02 - Reconciliation flow.** **Acceptance:** Export, local re-import and identity matching produce a truthful matched/unmatched report; every matched recipe reference resolves locally; nothing writes to R2; nothing deletes anywhere. **Required verification:** Vitest and an integration test over the e2e cloud server with a seeded hosted library. **Implementation:** Implemented in code: `web/src/cloud/migration/ReconciliationPanel.tsx` links to the existing account archive export and this-device library importer, then reads both catalogues and matches only identical content hashes. The 10,000-item paging safety limit now marks an incomplete report instead of implying the displayed rows are exhaustive. It explains how to return and refresh the report; the flow never uploads, moves, deletes or revokes hosted originals. Regression checks, the seeded-hosted-library integration (including recipe-reference resolution) and a real hosted-account rehearsal remain pending. **Independently Verified:** No.
3. **BF-0465-03 - Coexistence precedence.** **Acceptance:** The device-first, hosted-fallback resolution is implemented and visible (each queue item shows its source); mixed-source seams follow the capability record; a session never stalls on an unresolvable track without saying so. **Required verification:** `test_room_to_play.py` and playback suite extensions, Playwright mixed-library spec. **Implementation:** Implemented in code: `web/src/media/resolve.ts` resolves device media first and falls back to hosted media when available; `web/src/cloud/localFirstPlayer.ts` records each queue item’s source, and `web/src/cloud/QueueSources.tsx` presents source, pending state and unavailable reason. Mixed-source transitions consult the seam capability record and expose a reason when a safe transition is unavailable. Regression, playback integration and Playwright mixed-library tests are pending the final test phase. **Independently Verified:** No.
4. **BF-0465-04 - Cutover notice.** **Acceptance:** The one-time notice ships to grandfathered accounts with the agreed wording (nothing changed, what the default means, the voluntary path); no other migration messaging exists anywhere (audit). **Required verification:** Copy review by the owner, message-audit test. **Implementation:** Implemented in `web/src/cloud/migration/CutoverNotice.tsx` with per-account dismissal. Message-audit regression testing is pending the final test phase. Needs a person: the owner approves the wording. **Independently Verified:** No.
5. **BF-0465-05 - Support runbook.** **Acceptance:** Runbook entries for the missed-grant symptom, reconciliation questions and the rollback procedure, in `docs/operations/`; the rollback is rehearsed once against staging. **Required verification:** Doc review plus the rehearsal record. **Implementation:** Implemented in `docs/operations/bf-rollout-runbook.md` (missed-grant symptom and remedy, reconciliation questions, rollback). Runbook regression/review checks remain for the final test phase. Needs a person: one rollback rehearsal against staging. **Independently Verified:** No.
6. **BF-0465-06 - Real-account migration rehearsal.** **Acceptance:** One real grandfathered account (the owner's test account) walks export, re-import and reconciliation on real hardware; the report matches reality; the hosted library is untouched afterwards. **Required verification:** Recorded rehearsal under ADR-0466. **Implementation:** Not started. Needs a person: a real account and device. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17: grandfather all who uploaded, never force migration, never delete. Any future narrowing of the grandfathered population or retirement of the hosted plane is a new ADR with its own owner decision; this programme's tasks cannot be cited as authority for either.
