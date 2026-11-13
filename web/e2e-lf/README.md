# Local-first browser acceptance probes (NOT enabled by default)

This directory is deliberately excluded from the existing `web/playwright.config.ts`
(`testDir: './e2e'`) and no global test discovery files are changed.

When Agents 10–14 have integrated genuine local-first UI and staged the five-of-eight,
controller-only, partitioned speaker, stale-readiness and venue fixtures, configure:

- `SELECTA_LF_E2E_FIVE_OF_EIGHT_URL` — actual authenticated recipe URL (engine-a, 5/8)
- `SELECTA_LF_E2E_CONTROLLER_URL` — controller-only account/session
- `SELECTA_LF_E2E_PARTITION_URL` — speaker race test with source partition instrumented
- `SELECTA_LF_E2E_STALE_URL` — aged device availability
- `SELECTA_LF_E2E_VENUE_URL` — unknown/degraded output with several venue zones
- `SELECTA_LF_E2E_STORAGE_STATE` — optional authenticated Playwright state file

The UI integrators must preserve or implement the `lf-*` test IDs declared in the spec,
or update those expectations in a dedicated LF19 integration review. These are
**proposed test hooks**, not evidence the UI exists today.

After integration, from `web/` run:

```sh
pnpm exec playwright test -c e2e-lf/playwright.config.ts
```

The URLs must be localhost by default; explicitly set
`SELECTA_LF_E2E_ALLOW_STAGING=yes` to use an authorised isolated staging
instance. A missing URL **fails** each test; there are no skips, fake DOM
assertions, mocked servers or test-time production code changes. Browser test
results do not replace independently captured physical audio measurements.
