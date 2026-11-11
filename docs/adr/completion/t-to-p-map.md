# Inherited work: Selecta 2.0 parity rows and unfinished T tasks mapped to polish P tasks

- **Task:** P0005 ([polish checklist](../polish-implementation-checklist.md), [ADR-0033](../adr-0033-polish-baseline-and-governance.md))
- **Made:** 2026-11-11, from the open lines of [implementation-checklist.md](../implementation-checklist.md) and the rows of [feature-parity.md](../feature-parity.md)
- **Checked by:** `tests/test_polish_governance.py::test_p0005_every_open_t_task_and_parity_row_maps_to_real_p_tasks`

## Counting rule (no double counting)

A T task and the P tasks it maps to are counted separately, each only in its own programme and only
where its own evidence lands. Ticking a P task never ticks the T task it inherits from, and a ticked T
task is never counted as P progress. The original T IDs, their wording and their evidence stay on their
own lines in [implementation-checklist.md](../implementation-checklist.md); this page only points from
one to the other. "Shared evidence" means one test or capture may be cited by both lines, but each line
still records it on its own.

## Unfinished T tasks

Every T task still open on 2026-11-11 is listed once. "None" means the work has no polish counterpart and
stays only in the Selecta 2.0 programme.

| T task | What it asks (short) | P tasks | Relationship |
|---|---|---|---|
| T0001 | Pin the pre-redesign SHA; archive screenshots, API responses, settings, playback traces | P0001, P0004 | Overlaps: P0001 pins the polish baseline (`fe785ec`), not the pre-redesign one |
| T0004 | Verify the acceptance ledger against code; flag historical limits | P0009, P0142 | Shared evidence: the polish ledger follows the same rule for its own tasks |
| T0005 | Agree in-scope features, non-goals, backend-blocked capabilities | P0140 | Overlaps: owner review of findings and accepted limitations |
| T0014 | Accessible component tests, visual-regression baseline, real Web Audio smoke tests | P0031, P0132 | Shared evidence for component tests and baselines; Web Audio smoke stays T-only |
| T0017 | Approve quality gates; name owners for every parity row | None | Selecta 2.0 governance only |
| T0018 | Approve phase order, code ownership, migration boundaries | None | Selecta 2.0 governance only |
| T0029 | Approve ADR-0003 and document visual exceptions | P0013, P0020 | Shared evidence: documented spacing and one-off exceptions |
| T0038 | Agree WCAG 2.2 AA target and browser/assistive-technology matrix | P0121 | Same decision; record it once and cite it from both lines |
| T0043 | Audit form validation, errors, non-colour state, reduced motion | P0024, P0115, P0119, P0125 | Shared evidence |
| T0044 | Keyboard-only, NVDA/VoiceOver and 200/400% zoom journeys | P0123, P0126, P0128 | Same human sessions |
| T0059 | Virtual keyboard, touch/drag alternatives, landscape, zoom, embedded scrolling | P0087, P0122, P0123 | Same human device checks |
| T0060 | Approve ADR-0024 with recorded narrow-viewport evidence | P0122 | Shared evidence: MP-0298-01 width sweep |
| T0061 | Verify manifest, icons, Chrome/Edge install path | P0069, P0121 | Same installed-app check |
| T0062 | Standalone launch, reload and deep links needing the local server | P0069 | Same check |
| T0065 | Chrome/Edge installed mode; Firefox/Safari fallbacks | P0121 | Support matrix |
| T0068 | Typed API client/services, central cache ownership and polling | P0037 | Overlaps: refresh policy only; the client refactor stays T-only |
| T0094 | Reconnect, retry and idempotent recovery for every durable mutation | P0138 | Shared scenarios |
| T0096 | Show conflicts instead of silently overwriting newer state | P0078 | Overlaps: stale edits and deletion in another tab |
| T0097 | Backend stop/restart during edit, request, export, storage; tab sleep/wake | P0111, P0138 | Shared scenarios |
| T0135 | Explanatory fallback, missing factors, stale rating, announcements | P0117, P0128 | Screen-reader part is the same human session |
| T0201 | Every Studio cell, presets, incomplete stems, AI paths, undo, A/B audio | P0087, P0088 | Same listening and device checks |
| T0216 | Native folder picker with safe local binding | P0050 | Both superseded (ADR-0134 and ADR-0126): the owner declined the picker |
| T0251 | Two simultaneous requests, bridge approval, stale cancellation replay | P0098 | Shared evidence: `Requests.test.tsx` races |
| T0252 | Manual cue change while a render finishes and fallback plays | P0075, P0078 | Shared evidence |
| T0253 | Studio audition, pause main, navigate, commit seam, render failure recovery | P0088 | Same audible session |
| T0255 | Metadata override while analysis finishes and the watcher finds files | P0103, P0111 | Overlaps |
| T0256 | Backend restart mid-mutation, reconnect/retry, two-tab takeover | P0069, P0137, P0138 | Shared scenarios; audio part needs a person |
| T0258 | End-to-end integration tests with representative fixtures | P0134, P0138 | Same candidate run |
| T0261 | Deterministic real Web Audio tests for seek, late seam, fallback, preview, media keys | P0137 | Overlaps: P0137 needs real audio evidence too |
| T0262 | Visual regression: themes, 320px-4K, safe areas, reduced motion, zoom | P0132, P0133 | Same baselines and review |
| T0263 | Keyboard-only request, Mixes, Edit, Studio, Library, export, study | P0126 | Same journeys |
| T0264 | NVDA, VoiceOver and mobile assistive-technology testing | P0128 | Same sessions |
| T0265 | Profile >20k Library, >100-song Edit, Studio, concurrent render | P0104, P0135 | Same traces on recorded hardware |
| T0266 | Unguided user tasks for listener, creator, expert editor | P0139 | Same sessions |
| T0267 | Blind listener comparisons; audio quality apart from render pass | None | Audio quality is outside the polish programme |
| T0269 | Audit every ADR acceptance criterion with linked CI/QA proof | P0142 | Overlaps: polish ADRs only |
| T0274 | Fresh PWA install, normal tab, upgraded installation | P0121 | Installed-app row of the matrix |
| T0275 | Resolve critical integrity, audio, bridge, accessibility, export, privacy blockers | P0140 | Same blocker review |
| T0276 | Windows CI plus browser/audio/a11y gates on the release candidate | P0134, P0143 | Same candidate run |
| T0277 | Final human listening evidence and accepted limitations | P0143 | Same release review |
| T0278 | Every checklist item has an implementing PR and evidence | P0009, P0142 | Same rule for each programme's own items |
| T0279 | Close the tracking PR only once delivery is complete | P0143 | Same release disposition |

## Feature-parity rows

Each row of [feature-parity.md](../feature-parity.md) and the P tasks that polish that capability. The
parity row's own verification stays in the Selecta 2.0 programme.

| Parity row | P tasks |
|---|---|
| Folder import, background watcher, new-song scan, analysis initiation and pause | P0044, P0045, P0046, P0047, P0048, P0051, P0105, P0111 |
| Sixteen preset vibes, Selecta pick, unavailable reasons and creation | P0032, P0052, P0053, P0054 |
| Smooth/Punchy; Never/Sometimes/Often stems; 5-stop curve/reset; destination; duration presets | P0056, P0057, P0058 |
| Current mix playback, gapless Web Audio scheduling, resume, old seam-skip, spectrum and waveform | P0034, P0061, P0062, P0066, P0137 |
| Lyrics word/line focus, beat countdown, fullscreen Stage | P0064, P0068 |
| Media Session, mini-player, global shortcuts and notifications | P0028, P0029, P0067, P0069 |
| Bigger/Calmer/Something else next-up steering | P0065, P0116 |
| Concurrent requests, optimistic creation, cancel, live placement, bridge choice/approval, Play anyway and ghost rows | P0089, P0090, P0091, P0092, P0098 |
| Editor insert, ranked recommendations, Analyse, reorder, lock, remove, scoped Undo | P0035, P0070, P0071, P0072, P0073, P0078 |
| Seam style, phrase, length, entry/exit, warnings, audits, previews, Good/Bad, fallback and render all | P0074, P0075, P0076, P0077 |
| Eight-stem Studio with 64 binary cells, solo, shapes, AI arrange/fine tune, restore, Use this | P0080, P0081, P0082, P0083, P0084, P0085, P0086, P0087, P0088 |
| Draft save/duplicate/rename/delete/restore/play swap, queue priority/order and undo | P0055, P0059, P0060 |
| Library search, Ready/Not yet/Priority/Set aside/Everything, Never play and actions | P0033, P0100, P0101, P0102, P0103, P0104 |
| Word-link previews, ratings and pair add; harmonic four-stage audition and Yes/No/Skip | P0036, P0093, P0094, P0095, P0096, P0097, P0099 |
| Storage budget/usage, priorities, analysis, watcher, ETA and memory | P0105, P0107, P0111 |
| Blind comparison study code, A/B, tags, rating, choice and save recovery | P0110 |
| FLAC mix export, render prerequisites and final download | P0108, P0109 |
| Loopback host/origin protections and installable PWA | P0010, P0049, P0069, P0121 |
