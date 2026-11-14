/** Browser-device acceptance skeleton: intentionally NOT a real model inference benchmark.
 * Run separately with a spec-aware config; default Playwright testMatch is *.e2e.ts.
 * An integration owner should add this to Agent 10's dedicated browser matrix. */
import {test, expect} from "@playwright/test";
import {MODEL_AUDIT, browserShippingReady} from "../src/dsp/neural/registry";
import {selectModel} from "../src/dsp/neural/select";

test("no phone or tablet is automatically excluded, yet no untested model is available", () => {
  for (const platform of ["phone", "tablet", "desktop"]) {
    const evidence = {
      platform, backends: ["wasm"] as const,
      freeBudgetBytes: 1024 * 1024 * 1024,
      playbackImminent: false, measurements: {}
    };
    expect(selectModel("beat_this.small0", evidence).supported).toBe(false);
  }
  for (const id of Object.keys(MODEL_AUDIT) as (keyof typeof MODEL_AUDIT)[]) {
    expect(browserShippingReady(id)).toBe(false);
  }
});
