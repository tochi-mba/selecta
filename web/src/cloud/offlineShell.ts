// Registering Cloud's app-shell service worker (public/cloud-sw.js, `cloud.offline_shell`).
//
// CloudApp calls `syncOfflineShell(on)` once the account's flags are known: on registers the
// worker at scope "/" and hands it the shell files this page already loaded, so the first visit
// is enough for an offline reload; off unregisters it and deletes its cache, so the site is
// exactly as it was without it. The kiosk player's own worker (kiosk-sw.js, scope /kiosk) is
// never touched, and Local mode never calls this.

export const CLOUD_SW_URL = '/cloud-sw.js';
export const CLOUD_SHELL_CACHE = 'selectadj-cloud-shell';

type RegistrationLike = {
  active?: { scriptURL: string; postMessage?: (message: unknown) => void } | null;
  installing?: { scriptURL: string } | null;
  waiting?: { scriptURL: string } | null;
  unregister(): Promise<boolean>;
};
type ContainerLike = {
  register(url: string, options?: { scope?: string }): Promise<RegistrationLike>;
  getRegistrations(): Promise<readonly RegistrationLike[]>;
  ready: Promise<RegistrationLike>;
  controller?: { scriptURL: string } | null;
};

function container(): ContainerLike | undefined {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as ContainerLike) : undefined;
}

function isCloudWorker(registration: RegistrationLike): boolean {
  const script = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL ?? '';
  return script.endsWith(CLOUD_SW_URL);
}

/** The same-origin shell files this page has loaded (scripts, styles, icons, the manifest). */
export function loadedShellFiles(): string[] {
  try {
    const entries = typeof performance !== 'undefined' && performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
    const origin = window.location.origin;
    return entries
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          const url = new URL(name);
          return url.origin === origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest');
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** Whether Cloud's app-shell worker opened this page: then the page is Cloud, and with no
 * connection it opens from this device instead of saying SelectaDJ can't be reached (RuntimeApp). */
export function cloudShellOpened(worker: Pick<ContainerLike, 'controller'> | undefined = container()): boolean {
  try {
    return !!worker?.controller?.scriptURL.endsWith(CLOUD_SW_URL);
  } catch {
    return false;
  }
}

let last: boolean | null = null;

/** Register or unregister the app-shell worker. Safe to call on every account read; never throws. */
export async function syncOfflineShell(on: boolean, worker: ContainerLike | undefined = container()): Promise<void> {
  if (!worker || last === on) return;
  last = on;
  try {
    if (on) {
      await worker.register(CLOUD_SW_URL, { scope: '/' });
      const ready = await worker.ready;
      ready.active?.postMessage?.({ type: 'cloud-shell-warm', urls: loadedShellFiles() });
      return;
    }
    for (const registration of await worker.getRegistrations()) {
      if (isCloudWorker(registration)) await registration.unregister();
    }
    if (typeof caches !== 'undefined') await caches.delete(CLOUD_SHELL_CACHE);
  } catch {
    // a browser that refuses service workers (private windows, some settings) simply has none
    last = null;
  }
}
