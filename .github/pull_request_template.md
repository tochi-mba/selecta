## What and why

<!-- What changes, and why. Link the ADR and checklist tasks (SC-xxxx-nn) this moves. -->

## How it was verified

<!-- Tests added or run, coverage for the packages touched, manual checks (and listening, for audio). -->

## Checklist

- [ ] Every new feature, route, CLI command and job type is owned by a feature flag, and `docs/flags.md` is regenerated
- [ ] Schema changes have a migration; `pending_changes()` is empty at head
- [ ] Tests prove the new behaviour, including failure paths and edge cases from `docs/saas/18-test-plan.md`
- [ ] No secrets, signed URLs, tokens or personal data in logs, errors or the diff
- [ ] Local mode still behaves as before (or the change says why not)
- [ ] Docs and ADR checklist lines updated; ticked boxes cite `Evidence:`
- [ ] No file over 1,000 lines, and no em dashes
