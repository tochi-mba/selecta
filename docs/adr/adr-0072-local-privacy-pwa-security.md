# ADR-0072: Local-first privacy, file access, installed PWA and theme integration

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 6 of 8 tasks implemented with automated evidence on 2026-11-11; 1 implemented with its browser check pending; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0025, ADR-0031, ADR-0018
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Selecta serves a localhost app backed by local music. Source audio stays local, while LRCLIB may receive track metadata during lyric lookup. A new picker, discovery layer, telemetry library, font or PWA theme could unintentionally expand privacy or security surface.

## Decision proposed

Maintain local-first access boundaries and explicit metadata disclosure. Avoid external analytics, remote assets, unrestricted filesystem access and new cloud dependencies by default. Review the installed-app, offline and browser-security behavior of every design change.

## Experience and frontend architecture

- The backend continues binding to loopback and validating Host/Origin and song-ID requests. Never expose arbitrary original file paths in diagnostic exports or client-visible links. Browser directory handles do not equal trusted server-side absolute paths; any native picker requires a reviewed secure IPC path.

- Preserve manifest, service-worker behavior if applicable and installable Chrome/Edge flow; test dark/light theme-color behavior deliberately. Offline means connected/local server unavailable, not 'offline-capable music playback' unless explicitly supported.

- Any research instrumentation remains opt-in, local or synthetic unless separately approved. External typography, icon CDN and script dependencies should be avoided.

## Detailed implementation work

1. **S3-0072-01 - Implemented.** Audit existing loopback, Host/Origin, song-ID authorization and source-path handling during UI/API changes. **Evidence:** docs/adr/selecta-3-privacy.md 'Who can reach the server' and 'Paths the page can see'; tests/test_api_contracts.py test_other_hosts_get_nothing, test_other_sites_can_not_change_anything and test_diagnostics_have_no_paths_or_song_names; tests/test_s2_export_edges.py test_a_download_link_cannot_reach_outside_the_exports_folder (passed 2026-11-11).
2. **S3-0072-02 - Implemented.** Specify accurate user disclosure for LRCLIB metadata lookup during folder scan and manual lyrics commands. **Evidence:** docs/adr/selecta-3-privacy.md 'What leaves this PC' (rechecked 2026-11-11, with Lucy's optional remote provider added); tests/test_s3_docs_contracts.py test_every_remote_address_the_local_server_calls_is_disclosed; web/src/localPrivacyCopy.test.ts 'only drops the LRCLIB sentence when lyric lookup is turned off'; web/e2e/finishing.e2e.ts 'a first run says what leaves this PC before anything is sent' (passed 2026-11-11).
3. **S3-0072-03 - Implemented.** Assess safe directory selection and native IPC without exposing arbitrary filesystem access. **Evidence:** docs/adr/selecta-3-privacy.md 'Choosing a folder: why there’s no folder picker' (decision: a pasted path checked by the read-only GET /api/folders/check); tests/test_selecta3_changes.py test_folder_preflight_keeps_existing_library_unchanged; web/e2e/finishing.e2e.ts 'a folder that can’t be used says why and what to try, nothing is read, and another can be tried straight away' (passed 2026-11-11).
4. **S3-0072-04 - Needs a person.** Test installed Chrome/Edge PWA launch, route reload, icon/theme-color, standalone close and server dependency. **Status:** Needs a person: launching the installed Chrome and Edge app, reloading a route inside it, its icon and title-bar colour, closing a standalone window and starting it with the server stopped; the automated manifest check (web/e2e/mp-0298-responsive-and-a11y.e2e.ts 'MP-0298-07 (automated part) the installable app manifest is complete') passed 2026-11-11
5. **S3-0072-05 - Implemented.** Audit every new frontend dependency for network requests, content security, licensing and CSP impact. **Evidence:** docs/adr/selecta-3-privacy.md 'New dependencies' (no network, licence or CSP impact from @noble/hashes; @workos-inc/authkit-react only in Cloud mode); tests/test_s3_docs_contracts.py test_every_runtime_dependency_added_since_the_baseline_is_audited; the 2026-11-11 vite build puts both packages' code only in the lazily loaded CloudRoot chunk (the local main chunk holds only flag label text naming WorkOS) (passed 2026-11-11).
6. **S3-0072-06 - Implemented.** Define diagnostic copy/export redaction and never include sensitive metadata in public fixtures. **Evidence:** docs/adr/selecta-3-privacy.md 'Diagnostics and shared material'; web/src/diagnosticsOperations.test.ts 'copied diagnostics drop anything that is not a plain operation id, and every unknown field'; tests/test_api_contracts.py test_diagnostics_have_no_paths_or_song_names; fixtures are the made-up songs in tests/e2e_server.py (passed 2026-11-11).
7. **S3-0072-07 - Implemented.** Define no-server, disconnected-source and browser permission errors without false local privacy claims. **Evidence:** docs/adr/selecta-3-privacy.md 'What "offline" means'; web/src/apiFaults.test.ts 'nothing answering says Selecta can’t be reached and to try again' and 'a read that hangs gives up with words and a next step, and is not called offline'; web/src/gp-0263-offline.test.tsx 'a Library list that fails to load says the songs are fine, and offers a retry, not Add music'; disconnected source: web/src/views/Workshop.test.tsx 'show folders, and whether each can be found' (passed 2026-11-11).
8. **S3-0072-08 - Implemented; browser check pending.** Validate no unintended remote requests during navigation, audio previews and first-run. **Status:** Implementation: Implemented; browser check pending (web/e2e/s3-0072-local-requests.e2e.ts 'first screen, navigation, playback and a preview make no request beyond this computer (S3-0072-08)'). Its two 2026-11-11 failures were both in the wait for three transitions to render before any request was checked; the spec now uses a two-song mix (one transition) and starts that render before walking the pages, and has not been rerun since. The no-browser half passes: web/src/s3-0072-local-only.test.ts 'no source file or stylesheet names a remote host', 'every request the local app makes is a same-origin path', 'the page shell and installed-app manifest load only local files or inline data' and 'no stylesheet imports a font or sheet from elsewhere' (passed 2026-11-11)

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
