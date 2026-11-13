# Autopilot GO/NO-GO decision record (ADR-0440, AV-0440-05)

**Template.** Copy this file per release decision (go-no-go-YYYY-MM-DD.md). The decision and the
signatures are a person step: a named owner and an independent reviewer who did not build the
release sign it. `selecta.venueops.rollout.decide()` only ever answers NO-GO or ELIGIBLE FOR
SIGNED GO; it never answers GO.

## Release

- Release candidate SHA:
- Date:
- Scope: new commercial Autopilot venue features only (existing Local and Cloud ship on their own
  gates).
- Flags to enable at launch:

## Automated checks on this SHA

| Check | Command | Result | Evidence file |
|---|---|---|---|
| Phase order and flags | `python -m selecta.venueops.rollout` | | |
| Honest checklist status | same | | |
| Flag-off rollback | `pytest tests/test_apb_rollout.py` | | |
| Gate decision | `rollout.decide(...)` | | |

## P0 gates

| Gate | Pass / Fail / Missing | Evidence (file, test, log) | Evidence SHA |
|---|---|---|---|
| No unlicensed content or model | | | |
| No missing or modified original song | | | |
| No wrong song, revision or seam | | | |
| No unauthorized request bridging | | | |
| No overlapping speakers | | | |
| No uncommanded gap or resume | | | |
| Emergency Stop is accessible | | | |
| No venue or guest data leakage | | | |
| Flag-off rollback leaves existing features unchanged | | | |
| Six-hour real-audio soak on a supported speaker | | | |

## Other gates

| Gate | Result | Evidence |
|---|---|---|
| Every existing Local/Cloud feature preserved | | |
| Human AT, blind listening and venue pilot done | | |
| Specialist rights clearance | | |
| Commercial model licence review | | |

## Decision

- Verdict (GO / NO-GO):
- Reasons:
- Conditions or follow-ups:

## Signatures

| Role | Name | Independent of the build? | Signature | Date |
|---|---|---|---|---|
| Owner | | n/a | | |
| Independent reviewer | | yes | | |
