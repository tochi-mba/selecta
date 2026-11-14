import { describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { CheckpointError, loadCheckpoint } from "./checkpoint";

const manifest = {path:"/models/safe.onnx", sha256:"0".repeat(64), maxBytes:64};
describe("Integrity-checked model downloads", () => {
  it("refuses remote model hosts and unpinned manifests", async () => {
    const fetcher = vi.fn();
    await expect(loadCheckpoint({...manifest, path:"https://example.org/model.onnx"}, {fetcher}))
      .rejects.toMatchObject({code:"invalid_manifest"});
    await expect(loadCheckpoint({...manifest, sha256:"not-a-checksum"}, {fetcher}))
      .rejects.toBeInstanceOf(CheckpointError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a mismatching model digest", async () => {
    const bytes = new Uint8Array([1,2,3,4]);
    vi.stubGlobal("crypto", webcrypto);
    const fetcher = vi.fn().mockResolvedValue({
      ok:true, type:"basic", headers:{get:() => null},
      body:new ReadableStream({start(c) { c.enqueue(bytes); c.close(); }})
    });
    try {
      await expect(loadCheckpoint(manifest, {fetcher})).rejects.toMatchObject({code:"integrity"});
    } finally { vi.unstubAllGlobals(); }
  });
  it("returns only digest-matching model bytes, even after a cache eviction", async () => {
    const bytes = new Uint8Array([5,6,7]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    vi.stubGlobal("crypto", webcrypto);
    const cache = {get:vi.fn().mockResolvedValue(null), put:vi.fn().mockRejectedValue(new Error("quota"))};
    const fetcher = vi.fn().mockResolvedValue({
      ok:true, type:"basic", headers:{get:() => "3"},
      body:new ReadableStream({start(c) {c.enqueue(bytes); c.close();}})
    });
    try {
      const result = await loadCheckpoint({...manifest, sha256:hash}, {cache,fetcher});
      expect(result).toEqual(bytes);
      expect(fetcher).toHaveBeenCalledWith(manifest.path, expect.objectContaining({redirect:"error"}));
    } finally { vi.unstubAllGlobals(); }
  });
  it("treats a cancelled fetch as cancelled, not a success", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(loadCheckpoint(manifest, {signal:ctrl.signal})).rejects.toMatchObject({code:"cancelled"});
  });
});
