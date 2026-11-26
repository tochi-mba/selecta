import { useSyncExternalStore } from 'react';

// Installing SelectaDJ as an app (plan W5b). Chromium offers installation through a
// `beforeinstallprompt` event that fires once, early, often before the Cloud bundle has loaded,
// so main.tsx calls captureInstallPrompt() at app start and the event is kept here for an Install
// button to use later. Safari on iPad and iPhone has no such event: the person installs through
// Share, then Add to Home Screen, so those browsers get guidance instead of a button. Which one
// applies is decided by the browser's own APIs (`navigator.standalone` exists only in WebKit on
// iOS and iPadOS); the user agent is read for one thing only, to keep the Safari words out of
// browsers built into other apps, which expose the same API (inAppBrowser). Installing needs no service worker (current
// Chromium installs a site with a manifest alone); the app-shell worker that lets Cloud open
// offline is separate, behind `cloud.offline_shell` (offlineShell.ts).

/** The Chromium event, which is not in the DOM typings. */
export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** What this device can do about installing SelectaDJ right now.
 * - `installed`: SelectaDJ is open as an installed app (or was just installed).
 * - `prompt`: the browser offered installation; an Install button can ask it.
 * - `home_screen`: Safari on iPad or iPhone; the person adds it from the Share menu.
 * - `none`: nothing to offer (not installable here, or the browser has not offered yet). */
export type InstallState = 'installed' | 'prompt' | 'home_screen' | 'none';

export type InstallEnv = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean; userAgent?: string } & object;
};

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
let captured: EventTarget | null = null;
let state: InstallState = 'none';
const listeners = new Set<() => void>();

function defaultEnv(): InstallEnv {
  return {
    matchMedia: typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query) : undefined,
    navigator: typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : undefined,
  };
}

/** Open as an installed app: the display-mode media query, or Safari's own home-screen flag. */
export function isStandalone(env: InstallEnv = defaultEnv()): boolean {
  try {
    if (env.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (env.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  } catch {
    // a browser without display-mode queries is simply not standalone by that test
  }
  return env.navigator?.standalone === true;
}

/** The browsers built into other apps (Instagram, Facebook, TikTok, the Google app, LINE and the
 * like), by the tokens they add to the user agent. */
const IN_APP_TOKENS = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|musical_ly|BytedanceWebview|LinkedInApp|Snapchat|Pinterest|Twitter|\bLine\/|\bGSA\//;

/** A browser inside another app on iPhone or iPad. These are WebKit views that expose
 * `navigator.standalone` like Safari but have no Share, then Add to Home Screen, so they must not
 * be told to use it. The API cannot tell them apart, so this one question reads the user agent,
 * and it reads it conservatively: a known app's token, or an iOS web view that leaves out Safari's
 * own token (Safari, Chrome and Firefox on iOS all carry it). Anything unsure counts as a browser. */
export function inAppBrowser(env: InstallEnv = defaultEnv()): boolean {
  const agent = env.navigator?.userAgent ?? '';
  if (!agent) return false;
  if (IN_APP_TOKENS.test(agent)) return true;
  return /\b(iPhone|iPad|iPod)\b/.test(agent) && /AppleWebKit/.test(agent) && !/Safari\//.test(agent);
}

/** Safari on iOS or iPadOS (the browsers that expose `navigator.standalone`), but not a browser
 * inside another app, which has nothing to offer: no words beat words it cannot follow. */
export function addsToHomeScreen(env: InstallEnv = defaultEnv()): boolean {
  return !!env.navigator && 'standalone' in env.navigator && !inAppBrowser(env);
}

/** The install state from the facts, pure so tests can drive every branch. */
export function decideInstall(facts: { standalone: boolean; installed: boolean; prompt: boolean; homeScreen: boolean }): InstallState {
  if (facts.standalone || facts.installed) return 'installed';
  if (facts.prompt) return 'prompt';
  if (facts.homeScreen) return 'home_screen';
  return 'none';
}

let env: InstallEnv = defaultEnv();

function refresh() {
  const next = decideInstall({ standalone: isStandalone(env), installed: justInstalled, prompt: deferred !== null, homeScreen: addsToHomeScreen(env) });
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

/** Starts listening for the browser's install offer. Call once at app start; later calls are
 * no-ops for the same target. `target` and `given` are for tests. */
export function captureInstallPrompt(target: EventTarget | undefined = typeof window !== 'undefined' ? window : undefined, given?: InstallEnv): void {
  if (!target || captured === target) return;
  captured = target;
  if (given) env = given;
  target.addEventListener('beforeinstallprompt', (event) => {
    // Keep the offer for SelectaDJ's own Install button instead of the browser's banner.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    refresh();
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    refresh();
  });
  refresh();
}

/** Asks the browser to show its install dialog. The event can be used once, so it is dropped
 * whatever the answer; Chromium offers it again later if the person said no. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const offer = deferred;
  if (!offer) return 'unavailable';
  deferred = null;
  try {
    await offer.prompt();
    const choice = await offer.userChoice;
    if (choice.outcome === 'accepted') justInstalled = true;
    return choice.outcome;
  } catch {
    return 'unavailable';
  } finally {
    refresh();
  }
}

export function installState(): InstallState {
  return state;
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, installState, installState);
}

/** Tests only: forget the captured event and target. */
export function resetInstallForTests(): void {
  deferred = null;
  justInstalled = false;
  captured = null;
  env = defaultEnv();
  state = 'none';
  listeners.clear();
}
