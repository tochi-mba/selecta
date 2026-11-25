import { useRef, useState, useSyncExternalStore } from 'react';
import { feelOn, onFeelChange } from '../feel/root';
import { promptInstall, useInstallState, type InstallState } from './install';

/** What each install state says. Exported for the tests; `none` says nothing at all. */
export const INSTALL_COPY: Record<Exclude<InstallState, 'none'>, string> = {
  installed: 'Installed. SelectaDJ opens as its own app on this device.',
  prompt: 'Install SelectaDJ to open it as its own app. Installed, the browser is also more likely to keep its details on this device.',
  home_screen: "On iPad, tap Share, then Add to Home Screen. Installed, Safari keeps SelectaDJ's details instead of clearing them after a week away.",
};

/** Install SelectaDJ as an app, where this browser can (plan W5b). Renders nothing when there is
 * nothing to offer, so the surface around it reflows as if it were not there. `state` is for
 * tests and the gallery. */
export function InstallOffer({ state: given }: { state?: InstallState }) {
  const live = useInstallState();
  const state = given ?? live;
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState('');
  // With the feel system's motion on (ADR-0477), an install that happens while this offer is on
  // screen is confirmed with a drawn tick; an app that was already installed shows only the words.
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  const offered = useRef(false);
  if (state === 'prompt') offered.current = true;
  if (state === 'none') return said ? <p className="cloud-hint" role="status">{said}</p> : null;
  if (state !== 'prompt') {
    const confirmed = moving && state === 'installed' && offered.current;
    return (
      <p className="cloud-install" data-install={state} role={state === 'installed' ? 'status' : undefined}>
        {confirmed && <svg className="cloud-install-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
        {INSTALL_COPY[state]}
      </p>
    );
  }
  const install = () => {
    setAsking(true);
    void promptInstall().then((outcome) => {
      if (outcome === 'dismissed') setSaid('Not installed. You can install SelectaDJ later from the browser menu.');
    }).finally(() => setAsking(false));
  };
  return (
    <div className="cloud-install" data-install="prompt">
      <p>{INSTALL_COPY.prompt}</p>
      <div className="cloud-actions">
        <button type="button" onClick={install} aria-busy={asking || undefined}>Install SelectaDJ</button>
      </div>
    </div>
  );
}
