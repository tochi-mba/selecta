import { flushSync } from 'react-dom';
import { feelCalm } from '../feel/root';
import { flagOn } from '../flags';
import { prefs } from '../state/prefs';

/** Moving between pages (SF-0208-07, ADR-0477 FL-0477-03), using the browser's View Transitions API.
 *
 * It stays out of the way: it only runs when the browser has the API, the motion choice is
 * Expressive, the computer hasn't asked for reduced motion, the device is not in low power and
 * `app.scene_transitions` is on. In every other case the page changes at once, exactly as before.
 * Nothing here touches audio, and the address changes before any animation, so Back, reload and
 * sharing never wait on it.
 *
 * The router is a synchronous external store, so the swap is a manual `startViewTransition` around
 * `flushSync`; React's own ViewTransition component cannot drive it. While a transition runs,
 * `<html data-nav>` says which way the person went, and styles/feel-scene.css moves the page that
 * way. Things on both pages can be named so they travel instead of vanishing. */

/** Which way a navigation goes. `forward` drills in, `back` returns, `up` and `down` move between
 * neighbours in the rail, and `jump` is anything else. */
export type NavDirection = 'forward' | 'back' | 'up' | 'down' | 'jump';

/** An element on the page being left, and the name it shares with one on the page being opened. */
export type SharedElement = readonly [Element, string];

export type SceneOptions = {
  direction?: NavDirection;
  /** Asked only when a transition will run: null when the new page can be drawn at once, or a
   * promise for its code. The swap waits for it, but never longer than READY_WAIT_MS. */
  ready?: () => Promise<unknown> | null;
  share?: readonly SharedElement[];
};

/** The longest the swap waits for a page's code, so a slow network never holds a click. */
export const READY_WAIT_MS = 150;

/** The names a destination may give an element with `data-vt` (feel-scene.css maps each one). */
export const SHARED_NAMES = ['mix-art', 'song-art', 'page-title', 'player-art', 'brand-mark', 'palette'] as const;

type TransitionLike = {
  finished?: Promise<unknown>;
  skipTransition?: () => void;
};
type StartArgument = (() => unknown) | { update: () => unknown; types?: string[] };
type TransitionDocument = Document & { startViewTransition?: (update: StartArgument) => TransitionLike | undefined };

export function sceneTransitionsSupported(doc: Document = document): boolean {
  return typeof (doc as TransitionDocument).startViewTransition === 'function';
}

export function sceneTransitionsWanted(win: Window = window): boolean {
  if (!flagOn('app.scene_transitions') || !flagOn('app.motion_choice')) return false;
  if (prefs().motion !== 'expressive') return false;
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) return false;
  // low power at either step means no page travel; ui/lowPower.ts writes the attribute
  if (typeof document !== 'undefined' && document.documentElement.dataset.lowPower) return false;
  return !feelCalm();
}

/** Whether this browser takes `{ update, types }`. Older ones only take the callback. */
function typesSupported(): boolean {
  const ViewTransitionClass = (globalThis as { ViewTransition?: { prototype: object } }).ViewTransition;
  return !!ViewTransitionClass && 'types' in ViewTransitionClass.prototype;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
}

/** Where an address sits in the rail as drawn now, by the longest rail link it falls under, or -1.
 * Read from the page itself so the order is the one the person sees, in either shell. */
function railPlace(path: string, doc: Document): number {
  const bare = path.split('?')[0].replace(/\/+$/, '') || '/';
  let best = -1;
  let bestLength = -1;
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.nav a[href^="/"]:not(.brand)'));
  links.forEach((link, index) => {
    const href = (link.getAttribute('href') ?? '').split('?')[0].replace(/\/+$/, '') || '/';
    const under = bare === href || (href !== '/' && bare.startsWith(`${href}/`));
    if (under && href.length > bestLength) {
      best = index;
      bestLength = href.length;
    }
  });
  return best;
}

/** Which way a pushed navigation from one address to another goes. A deeper address under the one
 * you were on drills in; its parent goes back; two rail places compare by their order. */
export function navDirection(from: string, to: string, doc: Document = document): NavDirection {
  const a = from.split('?')[0].replace(/\/+$/, '') || '/';
  const b = to.split('?')[0].replace(/\/+$/, '') || '/';
  if (a === b) return 'jump';
  if (a !== '/' && b.startsWith(`${a}/`)) return 'forward';
  if (b !== '/' && a.startsWith(`${b}/`)) return 'back';
  const here = railPlace(a, doc);
  const there = railPlace(b, doc);
  if (here < 0 || there < 0 || here === there) return 'jump';
  return there > here ? 'down' : 'up';
}

let running: TransitionLike | null = null;
let generation = 0;

/** Name the shared elements on the page being left. A name used twice, or one already worn by
 * another element through `data-vt`, would make the browser give up on the transition; the update
 * still runs then, but this keeps the first of each name and quiets the rest so the travel happens.
 * Returns the undoing. */
function nameShared(share: readonly SharedElement[] | undefined, doc: Document): () => void {
  if (!share?.length) return () => undefined;
  const undo: (() => void)[] = [];
  const used = new Set<string>();
  for (const [element, name] of share) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || used.has(name) || !(element as HTMLElement).style || !element.isConnected) continue;
    used.add(name);
    const target = element as HTMLElement;
    for (const other of Array.from(doc.querySelectorAll<HTMLElement>(`[data-vt="${name}"]`))) {
      if (other === target) continue;
      const before = other.style.viewTransitionName;
      other.style.viewTransitionName = 'none';
      undo.push(() => { if (other.style.viewTransitionName === 'none') other.style.viewTransitionName = before; });
    }
    const before = target.style.viewTransitionName;
    target.style.viewTransitionName = name;
    undo.push(() => { if (target.style.viewTransitionName === name) target.style.viewTransitionName = before; });
  }
  return () => { for (const step of undo) step(); };
}

/** Show the next page: animated when everything above allows, otherwise immediately. A navigation
 * that arrives while one is still animating ends that one at once and goes on from there. */
export function changeScene(update: () => void, doc: Document = document, win: Window = window, options: SceneOptions = {}): void {
  // interruption: the running transition jumps to its end; its update has run or runs now
  const previous = running;
  running = null;
  try { previous?.skipTransition?.(); } catch { /* already over */ }

  if (!sceneTransitionsSupported(doc) || !sceneTransitionsWanted(win)) {
    update();
    return;
  }

  const root = doc.documentElement;
  const direction = options.direction ?? 'jump';
  const mine = ++generation;
  const unname = nameShared(options.share, doc);
  root.dataset.nav = direction;
  const settle = () => {
    unname();
    if (generation === mine) {
      delete root.dataset.nav;
      running = null;
    }
  };

  let ready: Promise<unknown> | null = null;
  try { ready = options.ready?.() ?? null; } catch { ready = null; }
  // with nothing to wait for the swap stays synchronous inside the browser's update callback
  const swap = ready
    ? async () => {
      await Promise.race([ready!.catch(() => undefined), wait(READY_WAIT_MS)]);
      flushSync(update);
    }
    : () => flushSync(update);

  const start = (doc as TransitionDocument).startViewTransition!.bind(doc);
  let transition: TransitionLike | undefined;
  try {
    transition = typesSupported() ? start({ update: swap, types: [direction] }) : start(swap);
  } catch {
    // a browser that refuses (a hidden tab, say) still gets the new page
    settle();
    update();
    return;
  }
  running = transition ?? null;
  // The browser gives up on the animation when the swap takes too long (a slow computer) or when a
  // newer transition skips this one. The page has still changed, so those rejections are expected
  // and must not surface as unhandled errors.
  const quiet = transition as { ready?: Promise<unknown>; updateCallbackDone?: Promise<unknown> } | undefined;
  quiet?.ready?.catch?.(() => undefined);
  quiet?.updateCallbackDone?.catch?.(() => undefined);
  const finished = transition?.finished;
  if (finished && typeof finished.then === 'function') finished.then(settle, settle);
  else settle();
}
