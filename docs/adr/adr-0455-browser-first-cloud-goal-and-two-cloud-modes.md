# ADR-0455 - Browser-first Cloud: goal and two Cloud modes

> Words: this record keeps the names of its time; [glossary.md](../glossary.md) says what each is called now (ADR-0479).

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 5/7 Implemented; 1/7 In progress; 1/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF0 (architecture and contracts). **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0390 (feature flags), ADR-0391 (Cloud goal and local guarantees), ADR-0392 (two runtime modes), ADR-0414 (flag targeting), ADR-0416 (Rooms): statuses unchanged. ADR-0396 to ADR-0399 and ADR-0409 (worker pools, object storage, uploads, playback proxies, hosting topology): content unchanged, their scope narrows to hosted-flag accounts under ADR-0456. Sibling BF ADRs: ADR-0456 to ADR-0467.
- **Source touchpoints:** `src/selecta/flags/cloud.json` (new `cloud.local_first`, new `cloud.hosted_media`); `src/selecta/modes/core.py`; `src/selecta/api_cloud.py`; `web/src/RuntimeApp.tsx`; `docs/adr/README.md`.
- **Proposal chapter:** [docs/saas/03-architecture.md](../saas/03-architecture.md) (runtime modes).

## Context and evidence boundary

SelectaDJ Cloud today assumes hosted media: accounts upload originals to R2, workers analyse and render them, and the browser streams presigned proxies (ADR-0396 to ADR-0399). The owner's direction on 2026-11-17 is that the default Cloud experience must instead be browser-first: no install, and the member's own browser does the audio work on the files it can reach, while Cloud keeps only metadata. At the same time the hosted experience is not retired: it remains available, per account, behind a feature flag an admin grants.

A prior attempt at this programme lived on the abandoned branch `docs/local-first-cloud-rearchitecture-20261113` (PR #64). That branch used ADR numbers 0455 to 0485 and the task prefix LF. It never merged and will not merge; `main` contains none of its files. This set reuses the numbers 0455 to 0467 on `main` and is the authoritative use of them. If that PR is ever reopened, it must be renumbered, not this set. Facts from its research (device capabilities, release-gate posture) were checked and reused; its structure and text were not.

This ADR records the accepted product direction. PR #96 implements substantial parts of the programme on its feature branch, including the browser runtime and local-media paths; those changes are not a production rollout. Both rollout flags remain default-off and the rollout ledger remains at Step 1 - dark. No device has been certified, and every device or browser capability claim still needs real-hardware evidence before release (ADR-0466). Hosted-media accounts remain supported behind the existing per-account grant; no hosted audio is being deleted or purged by this work.

## Decision

- **Two per-account Cloud modes.** Cloud has exactly two experiences, decided per account by flags, not by deployment:
  - **Local-first (the default for every account).** The browser owns audio end to end: import, decode, playback, DSP, render and export (ADR-0457, ADR-0458, ADR-0459). Cloud stores and serves accounts, tenancy, permitted catalogue metadata, portable mix recipes, schedules, Rooms and guest requests, metadata-only Lucy planning, billing, signed command and role security, and audit. Cloud never receives protected audio, PCM, stems, derived audio or raw private file paths from a local-first account.
  - **Hosted (admin-granted allowlist).** Today's hosted media plane, unchanged, for accounts with `cloud.hosted_media` on (ADR-0456). The programme-wide rule "Cloud never receives audio" therefore reads precisely: Cloud receives audio only from hosted-flag accounts.
- **No install.** The local-first experience needs a supported browser and nothing else: no Python, no FFmpeg, no daemon, no download. A single iPad or Android tablet can be a venue's actual player while it is foreground, awake, powered and output-tested (ADR-0460). No locked-screen or background-continuation promise is made.
- **Remote control, not remote audio.** Other signed-in devices control a playing browser device through signed, fenced, TTL-limited, metadata-only commands (ADR-0461).
- **Standalone local SelectaDJ is out of scope and unchanged.** The no-login local mode, its Python and FFmpeg engine and every ADR-0391 guarantee stay exactly as they are. `SELECTA_MODE=local` behaviour does not change in this programme.
- **Flags.** `cloud.local_first` (release, cloud mode) selects the local-first experience and, with the rest of the browser-first set, ships default on (owner decision 2026-11-22, before launch, with no customer accounts to grandfather; the ADR-0467 staged rollout is not needed). `cloud.hosted_media` (release, cloud mode) is on at the build layer so a rule can grant it, and `rules_default: false` makes it off for every account no rule grants: hosted mode is a staff grant. Both are ordinary four-layer flags (ADR-0390, ADR-0414): build, mode, plan, rules, then the member's own preference.

## User outcome and acceptance contract

A member opens SelectaDJ Cloud in a browser, connects their own music, and plays real mixed audio from that device without installing anything. Their music never leaves the device. A member the owner has granted hosted mode keeps today's upload-and-play experience with nothing changed. Nobody else can find an upload surface at all.

## Edge cases

- An account has both flags on: both experiences are reachable; the local-first navigation is the default and the hosted surfaces appear in their flagged places (ADR-0463). Playback precedence is defined in ADR-0465.
- An account has neither flag on (pre-rollout default): Cloud behaves exactly as on `main` today; this programme changes nothing until flags move.
- A guest in a Room never needs either flag: guests receive metadata and request surfaces only, never audio, in both modes (ADR-0416 unchanged).
- A member signs in on a device whose browser fails the capability probe (ADR-0460): they get controller and library surfaces with a plain explanation, never a false player.
- `SELECTA_MODE=local` deployments: both flags are cloud-mode only; local mode never consults them.

## Rejected alternatives

- **Retiring the hosted plane.** Rejected by the owner: existing hosted accounts keep working, and hosted mode stays available by grant (ADR-0456, ADR-0465). No deletion, purge or worker shutdown is authorised by this programme.
- **An installed local engine for Cloud.** A native helper or daemon as Cloud's audio engine would reintroduce installation, platform builds and update channels, and would exclude iPads and most tablets. Rejected; the browser is the runtime.
- **One global switch instead of per-account flags.** A deployment-wide mode cannot grandfather hosted accounts individually or run a staged rollout; per-account flags through the existing ADR-0414 targeting are already built.
- **Keeping PR #64.** Its ADRs mixed native-engine and browser assumptions, carried unverified claims, and merged unreviewed agent work. Abandoned in favour of this set.

## Implementation checklist - 5/7 Implemented; 1/7 In progress; 1/7 Not started; 0/7 independently Verified

1. **BF-0455-01 - Programme entry.** **Acceptance:** `docs/adr/README.md` lists the Browser-first Cloud programme (ADR-0455 to ADR-0467), states that standalone local SelectaDJ and existing hosted accounts are unchanged, and records the PR #64 numbering supersession. **Required verification:** Doc review. **Implementation:** Implemented in `docs/adr/README.md` (Browser-first Cloud section: programme range, standalone and hosted unchanged, PR #64 numbering superseded). Review against the full ADR set remains part of final documentation review. **Independently Verified:** No.
2. **BF-0455-02 - Register `cloud.local_first`.** **Acceptance:** Flag registered in `src/selecta/flags/cloud.json` (cloud mode, `kind: release`, default off) with surfaces for the local-first navigation; `docs/flags.md` regenerated; with the flag off, Cloud renders exactly as before this programme. **Required verification:** `tests/test_flags.py`, flag-off Playwright sweep. **Implementation:** Implemented: `cloud.local_first` in `src/selecta/flags/cloud.json` (cloud mode, release, default off, local-first surfaces) and `docs/flags.md`. The flag-off browser sweep remains pending; the flag remains dark by default. **Independently Verified:** No.
3. **BF-0455-03 - Per-account mode decision.** **Acceptance:** The account snapshot (`/api/account` features, per ADR-0414) exposes the decided experience (`local_first`, `hosted`, both, or neither) so the web shell renders from one answer; decisions are explainable through the existing admin "what does this user see" page. **Required verification:** Unit tests on the decision, `test_cloud_flag_gate.py` additions. **Implementation:** Implemented in code: `/api/account` carries the `experience` block (`src/selecta/api_cloud.py`), read by `web/src/cloud/api.ts` and `localFirstGate.ts`; `src/selecta/admin/flags_admin.py` returns the effective Cloud experience with each mode's decision reason, and `web/src/admin/FlagsPage.tsx` displays it with the per-flag trace. Regression tests and final verification remain pending. **Independently Verified:** No.
4. **BF-0455-04 - No-audio-egress contract.** **Acceptance:** An automated check asserts that with `cloud.hosted_media` off no Cloud route accepts audio bytes, multipart media or raw local paths from the account, and CI fails if a new route breaks this. **Required verification:** The check itself plus a negative test posting audio to every route. **Implementation:** Implemented in `tests/test_bf_no_audio_egress.py`; it covers refused upload writes and body-taking routes when the hosted grant is off. Re-run and CI evidence are pending the final test phase. **Independently Verified:** No.
5. **BF-0455-05 - Standalone guarantee snapshot.** **Acceptance:** A test proves `SELECTA_MODE=local` route and flag behaviour is byte-identical before and after the BF flags are registered (no new flags consulted, no new routes mounted). **Required verification:** `tests/test_modes.py` additions. **Implementation:** In progress: `tests/test_bf_flags_gating.py::test_every_bf_flag_is_cloud_mode_only_and_local_mode_never_serves_it` checks cloud-only registration and local defaults, but does not establish byte-identical route behaviour. Extend that guarantee check and run the local-mode regression suite. **Independently Verified:** No.
6. **BF-0455-06 - Copy and naming.** **Acceptance:** All member-facing copy for the two modes says SelectaDJ, names the local-first experience without jargon ("your music stays on this device") and never calls hosted mode deprecated; copy lives in the mode-keyed copy layer. **Required verification:** Vitest copy snapshot. **Implementation:** Implemented in the mode-keyed copy in `web/src/cloud/api.ts`, with coverage in `web/src/cloud/api.bf.test.ts`. Re-run the copy and banned-claim audit during the final test phase; owner review of public phrasing remains pending. **Independently Verified:** No.
7. **BF-0455-07 - Owner contract sign-off.** **Acceptance:** The owner reviews and signs the two-mode contract wording (what Cloud stores for each mode) as shown on the member-facing privacy and data pages. **Required verification:** Owner's recorded decision. **Implementation:** Not started. Needs a person: the owner. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17 in conversation. This checklist describes branch implementation, not release readiness; the flag remains default-off, hosted accounts remain supported, and no release gate is satisfied by this ADR alone. Older ADRs keep their statuses; scope narrowing for ADR-0396 to ADR-0399 and ADR-0409 is recorded in ADR-0456. Every release claim in this programme is gated by ADR-0466.
