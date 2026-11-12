# Creative-interface study cards

Per-task cards for the creative-interface tasks that close only with a person (triage package WP5:
CI-0165-02, CI-0165-07, CI-0166-07, CI-0168-07, CI-0169-07, CI-0172-07, CI-0178-07, CI-0179-07,
CI-0182-07 and CI-0184-04). They are written in the style of the [LX study kit](lx-study-kit.md)
and are scored the way `src/selecta/audit/ex_study.py` scores sessions.

Fixture for every card: the tests/e2e_server.py made-up library, built from the commit under test
(`cd web && pnpm exec vite build --outDir dist-study --emptyOutDir`, then
`SELECTA_E2E_DIST=dist-study python tests/e2e_server.py 9400`). Every song is synthesized; no real
music, account or folder is shown. Use `SELECTA_E2E_STRESS=1` only where a card says so.

Sessions are uncoached. Read the prompt exactly as written, answer no questions about the
interface during a task (say "Do whatever you would normally do"), and never point at the screen.
Record participants as codes (P01, P02), never names. One JSON record per participant and card:
`{"task", "facilitator", "date", "participant", "group", "coached": false, "consent": true,
"outcomes": [{"success", "seconds", "confidence", "hesitated"}]}`. Keep what the person did or
said (`observed`) apart from what anyone thinks caused it (`hypothesis`), as `ex_study.py` requires;
a record that mixes them, names a person, admits coaching or lacks consent is not counted.

Timing: start the clock when the prompt has been read, stop it when the person says "done" or
gives up. Confidence: after each task ask "How sure are you that you did what was asked, from 1
(not at all) to 5 (completely)?" and write the number. Hesitated: true or false, by the card's rule.

Consent line, read before starting: This session tests SelectaDJ, not you. It uses made-up songs
only. You can stop at any time. We note the time, whether you paused and how sure you felt, under a
code such as P01; no name, voice or screen recording is kept.

Groups: listener (plays music, does not mix), creator (makes playlists or mixes for others),
expert (has DJed or edits audio). Report every count as a raw numerator over denominator per group;
`ex_study.py` says "too few participants" below five per group, and that wording stands.

The pilot line on each card is a cognitive walkthrough done by Claude against a local build at the
stated SHA to check that the task can be completed and that the prompt has one reading. It is
preparation only: it is not a participant, a result or a finding, and it closes nothing.

PILOTS
