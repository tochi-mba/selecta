"""Usage ledger, storage quotas, reservations and allowances (ADR-0402).

- `schema`: the usage tables, declared on `persistence.metadata`.
- `ledger`: the append-only record of what each workspace uses, and its daily rollups.
- `quota`: storage limits, upload reservations and the over-quota read-only state.
- `allowances`: daily and monthly allowances that reset at the account's local midnight.
"""
