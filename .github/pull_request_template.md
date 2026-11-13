## What and why

<!-- What changes, and why. Link the ADR and checklist tasks (SC-xxxx-nn) this moves. -->

## How it was verified

<!-- Tests added or run, coverage for the packages touched, manual checks (and listening, for audio). -->

## Evidence record

<!-- SF-0239-08. Fill every line; "-" only where it truly doesn't apply. -->

- **Owner:** <!-- EX-0114-05: who owns this slice and answers for it -->
- **Verification:** <!-- the tests or checks that prove it, run on the tested SHA -->
- **Rollback:** <!-- the flag to turn off, or the commit to revert, to undo it -->
- **Tested SHA:** <!-- the exact commit the tests and screenshots ran on -->
- **Fixture:** <!-- made-up library (tests/e2e_server.py), SELECTA_E2E_STRESS=1, scale_server.py size, or a named real folder -->
- **Independent reviewer:** <!-- name and date, or "none yet": an implemented task is not Verified until someone else signs -->
- **Unresolved findings:** <!-- P0/P1/P2 still open, with where they're tracked, or "none" -->

## CSS changes

<!-- Only when a stylesheet changes (docs/adr/completion/css-ownership.md, review rules). One line per rule. -->

| Owning selector | Numeric delta | Visual evidence |
|---|---|---|
| <!-- styles/shell.css `.mini .round` --> | <!-- 40px to 44px at 320 and 1440 --> | <!-- web/e2e/mp-0281-mini-player.e2e.ts 'MP-0281-02' --> |

## Checklist

- [ ] Every new feature, route, CLI command and job type is owned by a feature flag, and `docs/flags.md` is regenerated
- [ ] Schema changes have a migration; `pending_changes()` is empty at head
- [ ] Tests prove the new behaviour, including failure paths and edge cases from `docs/saas/18-test-plan.md`
- [ ] No secrets, signed URLs, tokens or personal data in logs, errors or the diff
- [ ] Local mode still behaves as before (or the change says why not)
- [ ] Docs and ADR checklist lines updated; ticked boxes cite `Evidence:`
- [ ] No file over 1,000 lines, and no em dashes
