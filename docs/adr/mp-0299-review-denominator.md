# MP-0299-01 - Review denominator

What a complete human pixel review of the local app would have to look at, how much of it has
machine captures, and how much a named reviewer has actually reviewed. Computed from
`docs/adr/mp-0272-surface-inventory.json` (surfaces, their state denominators and the 11 viewports)
and `docs/adr/mp-0272-measured-summary.json` (viewports captured per fixture by
`web/e2e/mp-baseline.mp.ts`). `web/src/shell/mpReviewDenominator.test.ts` recomputes every number
below and fails when this page and the data disagree.

## Rules

- **Required** = for each surface, its state denominator x 11 viewports x 2 themes (Light and Dark;
  System always resolves to one of them, and forced colours is checked separately under ADR-298).
- **Captured** = for each surface, its measured states x the viewports the measured summary records
  for it (by surface id, else by fixture id). The baseline captures the Light theme only, so no Dark
  state counts as captured. A surface with measured states but no recorded viewports counts 0.
- **Reviewed** = states a named independent reviewer has signed. None yet.

## Counts

| Group | Surfaces | Required | Captured | Reviewed |
| --- | --- | --- | --- | --- |
| Routes | 17 | 2882 | 220 | 0 |
| Persistent surfaces | 6 | 264 | 33 | 0 |
| Overlays | 26 | 1584 | 157 | 0 |
| **Total** | **49** | **4730** | **410** | **0** |

Captured is 8.7% of required and reviewed is 0%. These are machine captures, which are candidates for
review, not a review.
