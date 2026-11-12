import { flushSync } from 'react-dom';
import { flagOn } from '../flags';
import { prefs } from '../state/prefs';

/** An optional cross-fade between pages (SF-0208-07), using the browser's View Transitions API.
 *
 * It is a prototype and stays out of the way: it only runs when the browser has the API, the motion
 * choice is Expressive, the computer hasn't asked for reduced motion and `app.scene_transitions` is
 * on. In every other case the page changes at once, exactly as before. Nothing here touches audio,
 * and the address changes before any animation, so Back, reload and sharing never wait on it. */

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

export function sceneTransitionsSupported(doc: Document = document): boolean {
  return typeof (doc as TransitionDocument).startViewTransition === 'function';
}

export function sceneTransitionsWanted(win: Window = window): boolean {
  if (!flagOn('app.scene_transitions') || !flagOn('app.motion_choice')) return false;
  if (prefs().motion !== 'expressive') return false;
  return !(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

/** Show the next page: animated when everything above allows, otherwise immediately. */
export function changeScene(update: () => void, doc: Document = document, win: Window = window): void {
  if (!sceneTransitionsSupported(doc) || !sceneTransitionsWanted(win)) {
    update();
    return;
  }
  try {
    (doc as TransitionDocument).startViewTransition!(() => flushSync(update));
  } catch {
    // a browser that refuses (another transition running, a hidden tab) still gets the new page
    update();
  }
}
