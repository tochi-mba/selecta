# Assistive-technology session log (S4-0110-10)

A person fills in one block below per session. Automated results are not evidence here: an axe pass
or a keyboard log from `web/e2e/s4-0110-at-log.e2e.ts` is a machine reading, never a claim of full
WCAG 2.2 compliance, and never a stand-in for a session with a real screen reader.

The tasks are the seven in `docs/adr/selecta-3-accessibility.md` "Scripts for a person" (first run,
playback, editing, requests, Studio, export, zoom). Run each with NVDA and Edge on Windows, with
VoiceOver on a Mac or iPhone if one is available, and with TalkBack for the phone-sized journeys.

## How to fill a session

- Copy the template block, fill every field, and leave a field as `not available` rather than blank.
- Versions come from the tools themselves: NVDA Help > About, `edge://version`, Settings > About.
- A task passes only when it is finished without sighted help and every announcement in the script was
  heard once and was right. Anything else is `Partly` or `Fail`, with what happened in Notes.
- Before the session, run the automated log (command below) on the same commit and paste its
  `S4-0110-LOG` line's `commit` and `axe` fields here, so both readings name one build.

```
pnpm exec playwright test e2e/s4-0110-at-log.e2e.ts
```

## Template

```
### Session <n>
- Date:
- Tester (name):
- Commit SHA:
- Device and OS (with version):
- Browser (with full version):
- Screen reader (with version), or "keyboard only":
- Speech rate and verbosity settings:
- Zoom and text size:
- Automated log line (commit, axe version, violations):

| Task | Result (Pass / Partly / Fail) | What was heard or went wrong |
|---|---|---|
| 1 First run | | |
| 2 Playback | | |
| 3 Editing | | |
| 4 Requests | | |
| 5 Studio | | |
| 6 Export | | |
| 7 Zoom | | |

- Limits found (each becomes a fault in the release-gates register):
- Signed:
```

## Sessions

No session has been recorded yet.
