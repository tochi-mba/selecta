# What needs a person

Some checks can't be done by code: listening by ear, screen-reader and keyboard sessions, real
phones and hardware, user studies, approving screenshots, named-reviewer sign-offs, legal work
and staging drills. They are all listed in one place now:

- **[Owner verification runbook](../../verification/owner-runbook.md)** groups every open
  "Needs a person" task from `docs/adr/*-implementation-checklist.md` into eight sittings.
  Each sitting has a step-by-step script, says what counts as a pass, and lists the task IDs
  it closes.
- **[Trackers](../../verification/tracker/)**: one table per sitting, with task ID,
  checklist, what the person does, and status.

`python -m selecta.audit.owner_runbook --write` builds both from the checklists, so the runbook
and trackers always match the checklists.
