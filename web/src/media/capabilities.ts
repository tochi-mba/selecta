// Import surface capability tests (ADR-0458, BF-0458-01).
//
// Which pickers a browser offers is decided by testing the capability, never by sniffing the
// user agent: `webkitdirectory` arrived on iOS Safari 18.4, Chrome Android grew pickers at 132,
// Samsung Internet mostly has neither, and hard-coding any of that would rot. A plain file
// input works everywhere, so every browser gets at least that. Each check answers with a
// `reason` in SelectaDJ's voice when unsupported, ready to show as the fallback explanation.

export type Capability = { supported: boolean; reason?: string };

/** A plain multiple-file input: the floor, available everywhere SelectaDJ runs. */
export function fileInput(): Capability {
  return { supported: true };
}

/** `<input webkitdirectory>`: folder choosing through the old input attribute. */
export function directoryInput(): Capability {
  try {
    if (typeof document === 'undefined') return { supported: false, reason: 'SelectaDJ cannot reach a page here, so there is nothing to pick with.' };
    const probe = document.createElement('input');
    if ('webkitdirectory' in probe) return { supported: true };
  } catch {
    // An exotic environment where creating an input throws is just an unsupported one.
  }
  return { supported: false, reason: 'This browser cannot pick a whole folder. Choose your music files instead and SelectaDJ imports them the same way.' };
}

/** `showDirectoryPicker`: the File System Access folder picker, with re-usable handles. */
export function dirPicker(): Capability {
  // A property can exist but be disabled or replaced with `undefined` by a restricted
  // context. Treat the picker as available only when the browser exposes a callable API.
  if (
    typeof window !== 'undefined'
    && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  ) return { supported: true };
  return { supported: false, reason: 'This browser has no folder picker, so SelectaDJ will ask you to choose files. Imports work the same; the browser just cannot remember the folder between visits.' };
}

/** OPFS: private browser storage SelectaDJ uses as a cache, never as a second library. */
export function opfs(): Capability {
  const storage = typeof navigator !== 'undefined'
    ? (navigator.storage as (StorageManager & { getDirectory?: () => Promise<unknown> }) | undefined)
    : undefined;
  if (storage && typeof storage.getDirectory === 'function') return { supported: true };
  return { supported: false, reason: 'This browser has no private file storage, so SelectaDJ re-prepares tracks each visit instead of caching them.' };
}

export type StorageSpace = Capability & { usage?: number; quota?: number; persisted?: boolean };

/** How much browser storage SelectaDJ may use, and whether the browser promised to keep it.
 * Private mode and cleared site data make this small or lying, so callers treat it as a hint:
 * losing the cache loses time, never music. */
export async function storageSpace(): Promise<StorageSpace> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return { supported: false, reason: 'This browser does not say how much storage SelectaDJ may use.' };
    }
    const estimate = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { supported: true, usage: estimate.usage, quota: estimate.quota, persisted };
  } catch {
    return { supported: false, reason: 'This browser does not say how much storage SelectaDJ may use.' };
  }
}
