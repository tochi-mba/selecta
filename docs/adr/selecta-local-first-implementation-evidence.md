# LF implementation evidence ledger

**Initial state:** ADR-0455 to ADR-0484 accepted on 2026-11-13; all 120 tasks Not started and independently unverified. The present PR is documentary only and supplies no implementation proof.

## How this ledger is used

Each LF checklist row has one unique `LF-xxxx-xx` ID. Implementation PR authors append evidence with the commit, exact changed source, test/CI run and user-visible result. An independent reviewer follows up separately; a successful implementation test is not independent verification.

| Task ID | Source commit and files | Test and CI run | Migration/rollback evidence | Independent reviewer and result |
|---|---|---|---|---|
| LF-0455-01 | Not started | Not started | Not started | Not verified |
| LF-0459-03 | Not started | Not started | Not started | Not verified |
| LF-0466-03 | Not started | Not started | Not started | Not verified |
| LF-0478-03 | Not started | Not started | Not started | Not verified |
| LF-0481-04 | Not started | Not started | Not started | Not verified |
| LF-0484-04 | Not started | Not started | Not started | Not verified |

The rows above are examples of high-risk work, not an assertion that only these six tasks require evidence. Add a row for each completed task when implementation begins. Preserve completed historical programme ledgers.

## Evidence quality

Valid: test name, run link, source SHA, hardware/output/region as applicable, actual observed behavior, reviewer. Invalid: "done", a screenshot of a mock state, an unexecuted task description, or a CI job known to skip the affected code.

## Programme exit

Use [verification](selecta-local-first-verification-matrix.md) and [release gates](selecta-local-first-release-gates.md). Final evidence must include both full connected and standalone parity, no-audio egress capture, licences and real device continuity.
