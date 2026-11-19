// Auto-update without interrupting service (ADR-0445 BZ-0445-08). A new kiosk version is fetched
// in the background by the service worker (public/kiosk-sw.js) and activated only while the zone
// is closed, which includes the 30 minutes before warming. An urgent fix (marked by REX
// Technologies) may activate while open, only at a song boundary where the next change is a
// simple fade, and it is logged. Activation reloads the page once ("Updating, back in a
// moment"); if it fails the player keeps the old version and reports it, never a blank page.

import type { DayState } from './startup';

export type UpdateInput = {
  running: string;
  latest: { version: string; urgent: boolean } | null;
  day: DayState;
  /** True right at a song boundary whose next change is a plain fade. */
  atFadeBoundary: boolean;
  /** The worker has the new files ready. */
  ready: boolean;
};

export type UpdateDecision = { activate: boolean; urgent: boolean };

export function updateDecision(input: UpdateInput): UpdateDecision {
  const wanted = input.latest !== null && input.latest.version !== input.running && input.ready;
  if (!wanted) return { activate: false, urgent: false };
  if (input.day === 'closed') return { activate: true, urgent: false };
  if (input.latest?.urgent && input.atFadeBoundary) return { activate: true, urgent: true };
  return { activate: false, urgent: false };
}

type WorkerLike = { postMessage(message: unknown): void };
type Registration = { active: WorkerLike | null; installing?: WorkerLike | null; waiting?: WorkerLike | null };
type ContainerLike = {
  register(url: string, options?: { scope?: string }): Promise<Registration>;
  addEventListener(name: 'message', handler: (event: MessageEvent) => void): void;
  controller: WorkerLike | null;
};

export type KioskWorker = {
  /** Ask the worker to fetch the newest kiosk files into a second cache. */
  check(): void;
  ready(): boolean;
  /** Swap to the new files; resolves true when the page should reload. */
  activate(): Promise<boolean>;
  failed(): boolean;
};

const defaultContainer = (): ContainerLike | undefined =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as ContainerLike) : undefined;

/** Register the kiosk's service worker; without one the player simply never updates itself. */
export async function registerKioskWorker(container: ContainerLike | undefined = defaultContainer()): Promise<KioskWorker> {
  let isReady = false;
  let hasFailed = false;
  let worker: WorkerLike | null = null;
  const waiters: ((ok: boolean) => void)[] = [];
  if (container) {
    try {
      const registration = await container.register('/kiosk-sw.js', { scope: '/kiosk' });
      worker = container.controller ?? registration.active ?? registration.waiting ?? registration.installing ?? null;
      container.addEventListener('message', (event: MessageEvent) => {
        const type = (event.data as { type?: string } | null)?.type;
        if (type === 'kiosk-update-ready') isReady = true;
        if (type === 'kiosk-update-failed' || type === 'kiosk-activate-failed') hasFailed = true;
        if (type === 'kiosk-activated' || type === 'kiosk-activate-failed') {
          waiters.splice(0).forEach((resolve) => resolve(type === 'kiosk-activated'));
        }
      });
    } catch {
      hasFailed = true;
    }
  }
  return {
    check: () => worker?.postMessage({ type: 'kiosk-check-update' }),
    ready: () => isReady,
    failed: () => hasFailed,
    activate: () =>
      new Promise<boolean>((resolve) => {
        if (!worker || !isReady) {
          resolve(false);
          return;
        }
        waiters.push(resolve);
        worker.postMessage({ type: 'kiosk-activate-update' });
        setTimeout(() => resolve(false), 30_000);
      }),
  };
}
