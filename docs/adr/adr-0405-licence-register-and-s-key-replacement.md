# ADR-0405 - Licence register and replacing S-KEY for commercial use

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 0/4 In progress; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 0. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** None; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/analysis/key.py`; `src/selecta/analysis/skey_model.py`; `src/selecta/stems.py`; `src/selecta/lyrics/align.py`; `docs/saas/licence-register.md`.
- **Proposal chapter:** [docs/saas/licence-register.md](../saas/licence-register.md).

## Context and evidence boundary

The key-detection model S-KEY is licensed for non-commercial research only (`analysis/skey_model.py:5-6`). Other weights have unstated or research-data licences. A paid service needs every model cleared.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- `docs/saas/licence-register.md` lists every model, dependency, system tool and data source with its licence and cloud-mode status.
- S-KEY is blocked in cloud mode and must be replaced before any paid plan: candidates are a self-trained key classifier on rights-cleared data, a tuned classical chroma/profile method (no weights), or a commercial licence from Deezer.
- Replacement accuracy is benchmarked against S-KEY on the owner's library and confirmed by listening.
- Cloud workers load models only from an allowlist generated from the register.

## User outcome and acceptance contract

Selecta Cloud never ships a model it isn't allowed to use commercially, and mixes don't get worse because of the change.

## Rejected alternatives

- Launching with S-KEY and fixing it later.
- Essentia or madmom models (AGPL or non-commercial).

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0405-01 - Register complete.** **Acceptance:** Every model and dependency in the worker images has a row. **Required verification:** Doc review against image contents. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0405-02 - S-KEY replacement.** **Acceptance:** Chosen replacement meets the agreed accuracy threshold against S-KEY. **Required verification:** Benchmark report plus listening check. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0405-03 - Model allowlist.** **Acceptance:** Cloud mode refuses to load an unlisted model. **Required verification:** Unit test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0405-04 - Legal review.** **Acceptance:** Rows marked Review are resolved by a lawyer before paid launch. **Required verification:** Written advice on file. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
