// The kiosk entry's fence (ADR-0453 D1, ADR-0445 BZ-0445-01): the kiosk bundle must hold no
// React and no manager code. `rooms.vite.ts` runs `forbiddenModules` over the real build and
// fails it on any hit; kioskBundle.test.ts runs the same rule over the kiosk's source imports.
// The only files from web/src/business the kiosk may load are the offline zone cache and the
// offline clock, which import nothing themselves.

export const KIOSK_ALLOWED_BUSINESS = ['src/business/offline/zoneCache.ts', 'src/business/offline/offlineClock.ts'] as const;

const FORBIDDEN: RegExp[] = [
  /[\\/]node_modules[\\/]react[\\/]/,
  /[\\/]node_modules[\\/]react-dom[\\/]/,
  /[\\/]node_modules[\\/]scheduler[\\/]/,
  /[\\/]src[\\/]business[\\/]/,
  /[\\/]src[\\/]cloud[\\/]/,
  /[\\/]src[\\/]ui[\\/]/,
  /\.tsx$/,
];

/** Whether one module path may be in the kiosk bundle. */
export function allowedInKiosk(path: string): boolean {
  const normal = path.replace(/\\/g, '/').split('?')[0];
  if (KIOSK_ALLOWED_BUSINESS.some((file) => normal.endsWith(file))) return true;
  return !FORBIDDEN.some((pattern) => pattern.test(normal));
}

export type FenceChunk = { type: 'chunk'; fileName: string; isEntry: boolean; name: string; imports: string[]; dynamicImports: string[]; moduleIds?: string[]; modules?: Record<string, unknown> };
export type FenceItem = FenceChunk | { type: 'asset'; fileName: string };

/** Every module the entry loads (its chunk and every chunk it imports) that breaks the fence. */
export function forbiddenModules(bundle: Record<string, FenceItem>, entryName = 'kiosk'): string[] {
  const chunks = Object.values(bundle).filter((item): item is FenceChunk => item.type === 'chunk');
  const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === entryName);
  if (!entry) return [];
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const chunk = bundle[name];
    if (chunk?.type === 'chunk') [...chunk.imports, ...chunk.dynamicImports].forEach(walk);
  };
  walk(entry.fileName);
  const bad: string[] = [];
  for (const name of seen) {
    const chunk = bundle[name];
    if (chunk?.type !== 'chunk') continue;
    const ids = chunk.moduleIds ?? Object.keys(chunk.modules ?? {});
    for (const id of ids) if (!allowedInKiosk(id)) bad.push(id);
  }
  return bad.sort();
}
