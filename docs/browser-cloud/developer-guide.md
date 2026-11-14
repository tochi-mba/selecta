# Developer/test setup, diagnostics and infrastructure

The **end user** needs only a supported browser, the HTTPS Cloud site, local media and
any external speaker hardware they choose. Python, Node, FFmpeg and Playwright
are optional **developer/CI tools**, never a customer installation step.

From repository root:

```sh
python src/selecta/devstack/browser_doctor.py
cd web
pnpm install --frozen-lockfile
node ../tools/browser_test/generate-fixtures.mjs
pnpm exec playwright install chromium firefox webkit
pnpm exec playwright test -c br64-10.playwright.config.ts
node ../tools/browser_test/summarise.mjs
```

On Windows use the repository's existing `dev.cmd` for standalone or
`dev.cmd cloud` for API/identity/worker development. Those developer commands
are not used by Cloud customers. The browser acceptance suite needs neither
Python Cloud API nor a local audio service; it starts its own **test-only** Node
fixture HTTP server on 127.0.0.1:5194. It never binds public interfaces and
always marks output as unverified/muted. `dev.cmd cloud --check` still covers
the separate local Cloud development stack.

## What logs and build audits must show

- AudioWorklet render callback count/frames and explicit digital mute flag.
- Input codec/container, decode result, source sample rate, number of channels,
  duration and errors; record browser decode resampling explicitly.
- Renderer/export actual chunk duration, storage pressure, interruption/cancellation,
  memory and thermals when measurable, and artifact hash after local validation.
- Whether the source is device-local, whether output was physically confirmed,
  and whether a lifecycle change caused output uncertainty.
- URL/network trace showing Cloud metadata-only and zero user media egress.

Bundling ownership integration: Agent 01 must ship worklet scripts with stable URLs
and MIME `text/javascript` and never use network/file IO inside process;
Agents 02/04/05 must ship local WASM/models with versioned manifests, licence
and hashes; Cloud deploy must set an explicit CSP, worker-src/connect-src
allowlist and appropriate COOP/COEP if using shared memory. Check Safari limits,
cross-origin model fetches and isolation before claiming compatibility. This agent
does not edit deploy.yml or another agent's runtime.

## CI policy

`browser-acceptance.yml` adds true headless browser runs on Ubuntu 24.04.
Existing TypeScript/Vitest/build, Python, Windows Edge, Cloud E2E and CodeQL checks
are *not removed*. Source policy gate rejects **new** hosted-audio fetch paths.
The baseline contains legacy Cloud upload branches, so release still requires:

```sh
python tools/browser_test/policy_gate.py --full
```

A complete passing production build audit, network trace and integration-level
tests are mandatory after Agent 09 removes hosted paths. A patch-scoped pass does
not confer production privacy compliance. See release-gates.md.
