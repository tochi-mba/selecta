# Selecta 2.0 — feature-parity ledger

- **Decision status:** Proposed
- **Implementation status of redesigned features:** Not started
- **Existing app:** behaviour and limitations are documented separately in [acceptance.md](../acceptance.md).

Each feature group below must remain reachable and functionally equivalent through the overhaul. The replacement is not verified until old/new workflows, backend state and audible outcomes are compared.

| Capability preserved | Proposed destination | Owning ADRs | New verification |
|---|---|---|---|
| Folder import, background watcher, new-song scan, analysis initiation and pause | Onboarding/Workshop | 0018, 0020 | Path, permission, watcher and failure tests |
| Sixteen preset vibes, Selecta pick, unavailable reasons and creation | Mixes | 0010 | Eligible/ineligible, one-click Play and draft tests |
| Smooth/Punchy; Never/Sometimes/Often stems; 5-stop curve/reset; destination; duration presets | Mix setup | 0010, 0011 | Preference scope, curve and planner constraints |
| Current mix playback, gapless Web Audio scheduling, resume, old seam-skip, spectrum and waveform | Listen | 0006, 0008 | Real audio timing and browser regression |
| Lyrics word/line focus, beat countdown, fullscreen Stage | Listen/Stage | 0008, 0009 | No-lyrics, precision and fullscreen tests |
| Media Session, mini-player, global shortcuts and notifications | App shell | 0002, 0004, 0006 | Route, OS media, focus and Undo tests |
| Bigger/Calmer/Something else next-up steering | Listen | 0008, 0027 | Plan update and upcoming audio tests |
| Concurrent requests, optimistic creation, cancel, live placement, bridge choice/approval, Play anyway and ghost rows | Requests/Edit | 0015 | Race, atomicity and playhead tests |
| Editor insert, ranked recommendations, Analyse, reorder, lock, remove, scoped Undo | Edit | 0013 | Current/draft isolation and stable identity tests |
| Seam style, phrase, length, entry/exit, warnings, audits, previews, Good/Bad, fallback and render all | Seam inspector | 0014 | Actual-vs-intended render and cue tests |
| Eight-stem Studio with 64 binary cells, solo, shapes, AI arrange/fine tune, restore, Use this | Studio | 0016 | Instant audio, grid keyboard and commit tests |
| Draft save/duplicate/rename/delete/restore/play swap, queue priority/order and undo | My Mixes | 0012 | Project and render-queue tests |
| Library search, Ready/Not yet/Priority/Set aside/Everything, Never play and actions | Library | 0017, 0018 | Large list, readiness and override tests |
| Word-link previews, ratings and pair add; harmonic four-stage audition and Yes/No/Skip | Discover | 0019 | Pair atomicity, scope and preview tests |
| Storage budget/usage, priorities, analysis, watcher, ETA and memory | Workshop | 0020, 0032 | Job, free space, failure and protection tests |
| Blind comparison study code, A/B, tags, rating, choice and save recovery | Listening tests | 0021 | Blindness, duplicate and failure tests |
| FLAC mix export, render prerequisites and final download | Export | 0022 | Decode and exact-revision tests |
| Loopback host/origin protections and installable PWA | App-wide | 0025, 0031 | Security and installed-app tests |

## Critical invariants for every implementation PR

1. No wrong current/draft resource mutation or undo.
2. No planned/queued seam or ghost request presented as ready to play.
3. Explicit selected style/cue intent not silently rewritten by fallback.
4. Approved multi-song bridge joins only when all necessary transitions are ready; no request duplication or contested placement.
5. Audio scheduling never skips a song beyond its valid seam or causes unplanned silence.
6. A preview never overlaps unrelated playback or auto-resumes against later user intent.
7. Existing original audio, drafts, persistent preferences, ratings and analysis are preserved.
8. User can recover from errors and operate essential workflows by keyboard.
9. No cloud dependency or unauthorized local file access.

**All redesigned feature rows: Not started / unverified.**
