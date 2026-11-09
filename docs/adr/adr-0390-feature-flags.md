# ADR-0390 - One feature-flag system for every feature

- **Decision:** Proposed (owner review pending).
- **Implementation:** 7/8 Implemented; 1/8 In progress; 0/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Feature flags (FF); 2026-11-09; main `e87d045`.
- **Priority / phase:** P1 / Release. **Owner:** Unassigned. **Implementing PR/SHA:** PR #42 (`37c6639`), then `1040ef8`, `2160075`.
- **Existing ADR owners:** ADR-0338 (LU-338-01, LU-338-05), ADR-0076 (S3-0076-03), ADR-0048 (S3-0048-08), ADR-0071 (S3-0071-08), ADR-0113 (S4-0113-04); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/flags/`; `src/selecta/api.py`; `src/selecta/seam_kinds.py`; `web/src/flags.ts`; `web/src/shell/manifest.ts`; `web/e2e/flags.e2e.ts`.

## Context and evidence boundary

Selecta has about ninety features and no standard way to turn one off. Lucy had its own switches,
the site had one browser-only kill switch for the classic navigation, and `API_FEATURES` advertised
capabilities without anything reading it. Several accepted ADRs ask for flags or kill switches. This
ADR records the system built for all of them. Automated checks prove the behaviour stated below;
they say nothing about how any feature sounds.

## Decision

One registry, `src/selecta/flags/*.json`, one file per area. Each flag has a label, what it is,
what it needs, the API routes and CLI commands it owns, the pages it shows up on and the words that
name it. The server, the site and the tests read the same files, and `docs/flags.md` is generated
from them.

- **Developers only.** Defaults are the committed files; `SELECTA_FLAGS` changes them for one run
  and is inherited by every child process. There is no switch page in the app.
- **Core is locked on.** Core flags are listed with the reason they can't be turned off.
- **Off means gone.** Routes answer 403 `flag_off` (never 404, which means an older server);
  background work stops at its source; CLI commands say so and exit 2; the site shows nothing about
  the feature, and every page closes up around it.
- **Nothing is deleted, and choices already made still count.** Only a transition move that's off
  can't be used, so a seam set to it is planned again, without changing what's saved.

## UI/UX and measurable acceptance contract

Every page and overlay a flag shows up on, with that flag off, every area off, and everything that
isn't core off, at 375 and 1280 px: no sideways scroll; no link to a page that's off; none of the
feature's words visible; no request to its routes; no empty container, lonely tab, bare heading or
stranded grid cell. Everything-off also passes axe WCAG 2.2 AA in both themes.

**Required negative cases:** unknown flag name, turning off a core flag, a server older than the
site (no `flags` in status), a site older than the server (`flag_off` answers), a saved seam whose
move is off, lyric lookup off (songs still become mix-ready), stems off (nothing separated).

## Rejected shortcuts

A switch page in the app (the owner chose developer-only flags); hiding features but leaving their
routes and background work running; greying controls out instead of removing them; flags read at
import time, which tests couldn't change.

## Implementation checklist - 7/8 Implemented; 0/8 independently Verified

1. **FF-0390-01 - Registry, loader and `SELECTA_FLAGS`.** **Acceptance:** every API route and CLI command belongs to one flag; cascades, presets and errors behave as stated. **Required verification:** `tests/test_flags.py`. **Implementation:** Implemented; **Independently Verified:** No.
2. **FF-0390-02 - Server enforcement.** **Acceptance:** each flag's routes refuse with `flag_off`; a refusal is never replayed. **Required verification:** `tests/test_flag_server.py`. **Implementation:** Implemented; **Independently Verified:** No.
3. **FF-0390-03 - Background work and moves.** **Acceptance:** lyric lookup, folder watching, spare time and stem separation stop; off moves are never planned, offered or rendered. **Required verification:** `tests/test_flag_server.py`. **Implementation:** Implemented; **Independently Verified:** No.
4. **FF-0390-04 - Lucy phases.** **Acceptance:** a phase is on only when the build and the person both say so; the person's choice is kept. **Required verification:** `tests/test_flag_server.py`. **Implementation:** Implemented; **Independently Verified:** No.
5. **FF-0390-05 - Site plumbing.** **Acceptance:** nav, tabs, commands, shortcuts, glossary and routes follow flags from one place. **Required verification:** `web/src/flags.test.tsx`. **Implementation:** Implemented; **Independently Verified:** No.
6. **FF-0390-06 - Pages reflow.** **Acceptance:** the contract above for every page and overlay. **Required verification:** `pnpm e2e:flags`. **Implementation:** Implemented; **Independently Verified:** No.
7. **FF-0390-07 - CI and docs.** **Acceptance:** the sweep is a required CI job; `docs/flags.md` can't fall behind. **Required verification:** CI run. **Implementation:** Implemented; **Independently Verified:** No.
8. **FF-0390-08 - Full sweep green in CI and screenshots reviewed by a person.** **Acceptance:** all 76 sweep tests pass on CI and the uploaded screenshots look designed. **Required verification:** CI run plus human review. **Implementation:** In progress; **Independently Verified:** No.

## Governance

Decision Proposed until the owner says otherwise. Older ADRs keep their statuses; this one only
links to them.
