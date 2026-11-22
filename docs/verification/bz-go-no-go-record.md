# SelectaDJ for Business GO / NO-GO record (ADR-0440, ADR-0454 S8, BZ-0441-09)

**Template.** The decision and the signature are a person step: the owner signs, after reading
`python -m selecta.business.rollout` and the [gate register](bz-gate-register.md). The code only
ever answers NO-GO or ELIGIBLE FOR SIGNED GO; it never answers GO and never fills this in.
`selecta.business.rollout.parse_go_record` counts the record as signed only when the Decision is
GO, the release SHA is a commit hash, Signed by names a person (not an agent) and the Date is
YYYY-MM-DD.

## Decision

- Decision: pending
- Phase: pending
- Release SHA: pending
- Signed by: pending
- Date: pending

## What the signer checked

| Item | Answer |
|---|---|
| `python -m selecta.business.rollout` verdict for Gate S on this SHA | |
| BZ-0449-11 legal gate: lawyer's written view, where it is filed | |
| BZ-0447-15 Stripe staging run and accountant review, where they are filed | |
| Pricing decision (BZ-0441-09): currency, venue, zone, seat, annual, volume, trial | |
| Pilot report (BZ-0441-07) and price-sensitivity results (BZ-0441-08) | |
| Rollback: `SELECTA_FLAGS -business.*` drill result | |

## After signing

Only then may `business.signups` lose its catch-all off rule. Phase B3 (US and EU) needs a new
signed record with Phase: B3.
