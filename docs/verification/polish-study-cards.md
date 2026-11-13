# Polish study cards

Per-task cards for P0139 in the [polish checklist](../adr/polish-implementation-checklist.md):
unguided tasks with casual listeners, creators and expert editors, recording task success, errors
and confusion without inventing results (triage package WP5). Written in the style of the
[LX study kit](lx-study-kit.md) and scored the way `src/selecta/audit/ex_study.py` scores sessions.

Fixture for every card: the tests/e2e_server.py made-up library, built from the commit under test
(`cd web && pnpm exec vite build --outDir dist-study --emptyOutDir`, then
`SELECTA_E2E_DIST=dist-study python tests/e2e_server.py 9400`). Every song is synthesized; no real
music, account or folder is shown. Restart the server between participants so each starts from the
same mix (Morning Light, Slow Tide, Paper Moon, Neon Rain).

Sessions are unguided. Read the prompt exactly as written, answer no questions about the interface
during a task (say "Do whatever you would normally do"), and never point at the screen. Record
participants as codes (P01, P02), never names. One JSON record per participant and card:
`{"task", "facilitator", "date", "participant", "group", "coached": false, "consent": true,
"outcomes": [{"success", "seconds", "confidence", "hesitated", "errors"}]}`. `errors` counts wrong
actions the person had to undo. Keep what the person did or said (`observed`) apart from what anyone
thinks caused it (`hypothesis`), as `ex_study.py` requires; a record that mixes them, names a person,
admits coaching or lacks consent is not counted.

Timing: start the clock when the prompt has been read, stop it when the person says "done" or
gives up. Confidence: after each task ask "How sure are you that you did what was asked, from 1
(not at all) to 5 (completely)?" and write the number. Hesitated: true or false, by the card's rule.
Confusion: write the person's own words when they say something is unclear, as `observed`.

Consent line, read before starting: This session tests SelectaDJ, not you. It uses made-up songs
only. You can stop at any time. We note the time, whether you paused and how sure you felt, under a
code such as P01; no name, voice or screen recording is kept.

Groups: casual listener (plays music, does not mix), creator (makes playlists or mixes for
others), expert editor (has DJed or edits audio). Give every card to every group; report success,
errors and confusion as raw numerator over denominator per group. Below five people per group,
`ex_study.py` says "too few participants" and that wording stands.

The pilot line on each card is a cognitive walkthrough done by Claude against a local build at the
stated SHA to check that the task can be completed and that the prompt has one reading. It is
preparation only: it is not a participant, a result or a finding, and it closes nothing.

PILOTS
