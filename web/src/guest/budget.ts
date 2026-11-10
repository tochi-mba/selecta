// The guest page's JavaScript budget (SC-0416-02), kept free of build-tool types so the unit
// tests and the build share one definition. `rooms.vite.ts` applies it to the real bundle.

export const GUEST_JS_LIMIT = 100 * 1024;

export type BundleChunk = { type: 'chunk'; fileName: string; code: string; imports: string[]; dynamicImports: string[]; isEntry: boolean; name: string };
export type BundleItem = BundleChunk | { type: 'asset'; fileName: string };

/** Bytes of JavaScript an entry loads: the entry and every chunk it imports, once each,
 * uncompressed, so gzip can't hide growth. */
export function jsBytesFor(bundle: Record<string, BundleItem>, entryName: string): number {
  const chunks = Object.values(bundle).filter((item): item is BundleChunk => item.type === 'chunk');
  const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === entryName);
  if (!entry) throw new Error(`No entry chunk is named ${entryName}`);
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const chunk = bundle[name];
    if (chunk?.type === 'chunk') [...chunk.imports, ...chunk.dynamicImports].forEach(walk);
  };
  walk(entry.fileName);
  const encoder = new TextEncoder();
  return [...seen].reduce((total, name) => {
    const chunk = bundle[name];
    return total + (chunk?.type === 'chunk' ? encoder.encode(chunk.code).length : 0);
  }, 0);
}
