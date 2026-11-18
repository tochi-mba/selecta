/** Who this device says it is, for the capability record's key only (ADR-0460, BF-0460-01).
 *
 * The record is stored per `device_model + os_version + browser_engine/version + ...` so a result
 * measured on one tuple is never borrowed by another. Filling those labels needs the browser's
 * own description of itself, so this is the one venue module allowed to read it. What it returns
 * is a label for filing results, never a gate: `qualification()` in capabilityRecord.ts reads
 * only the measured probes, and `noUserAgentGates.test.ts` holds both of those rules.
 *
 * User-Agent Client Hints are preferred where the browser has them (Chromium); elsewhere the
 * plain description string is parsed. Anything not stated is 'unknown', never guessed.
 */

export type DeviceIdentity = {
  device_model: string;
  os_version: string;
  browser_engine: string;
  browser_version: string;
  /** Where the labels came from, so a reader knows how much to trust them. */
  identity_source: 'client_hints' | 'description' | 'unknown';
};

export const UNKNOWN_IDENTITY: DeviceIdentity = {
  device_model: 'unknown',
  os_version: 'unknown',
  browser_engine: 'unknown',
  browser_version: 'unknown',
  identity_source: 'unknown',
};

type Hints = {
  getHighEntropyValues?(keys: string[]): Promise<{
    model?: string;
    platform?: string;
    platformVersion?: string;
    fullVersionList?: { brand: string; version: string }[];
  }>;
};

export type IdentitySource = { description?: string; hints?: Hints | null };

function browserSource(): IdentitySource {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { userAgentData?: Hints };
  return { description: nav.userAgent, hints: nav.userAgentData ?? null };
}

/** The rendering engine family from a description string: Blink, Gecko or WebKit. */
function engineOf(description: string): string {
  // Every browser on iPhone and iPad runs WebKit underneath, whatever its name.
  if (/iPhone|iPad|iPod/.test(description)) return 'webkit';
  if (/Firefox\//.test(description)) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\//.test(description)) return 'blink';
  if (/AppleWebKit\//.test(description)) return 'webkit';
  return 'unknown';
}

/** Labels from the plain description string (exported for tests). */
export function identityFromDescription(description: string): DeviceIdentity {
  if (!description) return UNKNOWN_IDENTITY;
  const engine = engineOf(description);
  const version = /Edg\/([\d.]+)/.exec(description)?.[1]
    ?? /(?:Chrome|CriOS)\/([\d.]+)/.exec(description)?.[1]
    ?? /Firefox\/([\d.]+)/.exec(description)?.[1]
    ?? /Version\/([\d.]+).*Safari/.exec(description)?.[1]
    ?? 'unknown';
  const os = /Android ([\d.]+)/.exec(description)?.[1] ? `Android ${/Android ([\d.]+)/.exec(description)![1]}`
    : /(?:iPhone|CPU) OS ([\d_]+)/.exec(description)?.[1] ? `iOS ${/(?:iPhone|CPU) OS ([\d_]+)/.exec(description)![1].replace(/_/g, '.')}`
      : /Mac OS X ([\d_]+)/.exec(description)?.[1] ? `macOS ${/Mac OS X ([\d_]+)/.exec(description)![1].replace(/_/g, '.')}`
        : /Windows NT ([\d.]+)/.exec(description)?.[1] ? `Windows NT ${/Windows NT ([\d.]+)/.exec(description)![1]}`
          : 'unknown';
  // Android puts the model before "Build/" or the closing bracket; everything else hides it.
  const model = /Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?\)/.exec(description)?.[1]?.trim()
    ?? (/iPad/.test(description) ? 'iPad' : /iPhone/.test(description) ? 'iPhone' : 'unknown');
  return { device_model: model || 'unknown', os_version: os, browser_engine: engine, browser_version: version, identity_source: 'description' };
}

/** This device's labels. Client Hints first; the description string where hints are absent. */
export async function deviceIdentity(source: IdentitySource = browserSource()): Promise<DeviceIdentity> {
  const fromDescription = identityFromDescription(source.description ?? '');
  const hints = source.hints;
  if (!hints?.getHighEntropyValues) return fromDescription;
  try {
    const values = await hints.getHighEntropyValues(['model', 'platform', 'platformVersion', 'fullVersionList']);
    const brands = values.fullVersionList ?? [];
    const named = brands.find((brand) => /Edge|Chrome|Opera|Samsung/i.test(brand.brand)) ?? brands.find((brand) => /Chromium/i.test(brand.brand));
    return {
      device_model: values.model || fromDescription.device_model,
      os_version: values.platform ? `${values.platform} ${values.platformVersion ?? ''}`.trim() : fromDescription.os_version,
      browser_engine: brands.some((brand) => /Chromium/i.test(brand.brand)) ? 'blink' : fromDescription.browser_engine,
      browser_version: named ? `${named.brand} ${named.version}` : fromDescription.browser_version,
      identity_source: 'client_hints',
    };
  } catch {
    return fromDescription;
  }
}
