# ADR-0072: Local-first privacy, file access, installed PWA and theme integration

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0025, ADR-0031, ADR-0018
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0072-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Selecta serves a localhost app backed by local music. Source audio stays local, while LRCLIB may receive track metadata during lyric lookup. A new picker, discovery layer, telemetry library, font or PWA theme could unintentionally expand privacy or security surface.

## Decision proposed

Maintain local-first access boundaries and explicit metadata disclosure. Avoid external analytics, remote assets, unrestricted filesystem access and new cloud dependencies by default. Review the installed-app, offline and browser-security behavior of every design change.

## Experience and frontend architecture

- The backend continues binding to loopback and validating Host/Origin and song-ID requests. Never expose arbitrary original file paths in diagnostic exports or client-visible links. Browser directory handles do not equal trusted server-side absolute paths; any native picker requires a reviewed secure IPC path.

- Preserve manifest, service-worker behavior if applicable and installable Chrome/Edge flow; test dark/light theme-color behavior deliberately. Offline means connected/local server unavailable, not 'offline-capable music playback' unless explicitly supported.

- Any research instrumentation remains opt-in, local or synthetic unless separately approved. External typography, icon CDN and script dependencies should be avoided.

## Detailed implementation work (all Not started)

1. **S3-0072-01 - Not started.** Audit existing loopback, Host/Origin, song-ID authorization and source-path handling during UI/API changes.
2. **S3-0072-02 - Not started.** Specify accurate user disclosure for LRCLIB metadata lookup during folder scan and manual lyrics commands.
3. **S3-0072-03 - Not started.** Assess safe directory selection and native IPC without exposing arbitrary filesystem access.
4. **S3-0072-04 - Not started.** Test installed Chrome/Edge PWA launch, route reload, icon/theme-color, standalone close and server dependency.
5. **S3-0072-05 - Not started.** Audit every new frontend dependency for network requests, content security, licensing and CSP impact.
6. **S3-0072-06 - Not started.** Define diagnostic copy/export redaction and never include sensitive metadata in public fixtures.
7. **S3-0072-07 - Not started.** Define no-server, disconnected-source and browser permission errors without false local privacy claims.
8. **S3-0072-08 - Not started.** Validate no unintended remote requests during navigation, audio previews and first-run.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Host/header/origin attacks, forged IDs, path traversal, invalid source path and symlink edge cases.
- Network capture for accidental external requests; only approved LRCLIB metadata flow if activated.
- PWA installed in dark/light, without local server, reconnect, fullscreen and deep-link restart.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A cloud analytics SDK would simplify tracking but violates local-first expectations. A browser-only folder picker would not solve server access. Choose native/local capability only when secure and needed.

## Acceptance and evidence

New presentation and optional integrations do not weaken privacy, file access, loopback or installed-app behavior.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
