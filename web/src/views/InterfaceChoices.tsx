import { flagOn } from '../flags';
import { listed } from '../shell/manifest';
import { setPrefs, usePrefs } from '../state/prefs';
import { keepFullMotion, useLowPower } from '../ui/lowPower';
import { ThemeChoices } from '../ui/ThemeChoice';

/** How this looks and behaves in this browser. Nothing here touches music, mixes or the server, so
 * any of it can be switched back, including the older navigation if the new one ever gets in the way.
 * `classicNav` is false where the older navigation has no pages to lead to (browser-first Cloud). */
export function InterfaceChoices({ classicNav = true }: { classicNav?: boolean } = {}) {
  const preferences = usePrefs();
  const lowPower = useLowPower();
  return (
    <section className="panel stack interface-choices">
      <h2>Interface</h2>
      <p className="hint">These are kept in this browser. None of them change your music or your mixes.</p>
      {flagOn('app.theme_choice') && <ThemeChoices />}
      {flagOn('app.motion_choice') && (
      <fieldset className="theme-choices">
        <legend>Motion</legend>
        <div className="chips" role="radiogroup" aria-label="Motion">
          {(['still', 'subtle', 'expressive'] as const).map((motion) => (
            <label className="choice" key={motion}>
              <input type="radio" name="selecta-motion" checked={preferences.motion === motion} onChange={() => setPrefs({ motion })} />
              {motion === 'still' ? 'Still' : motion === 'subtle' ? 'Subtle' : 'Expressive'}
            </label>
          ))}
        </div>
        <p className="hint">Still stops decorative movement. Your computer’s reduced-motion setting always takes priority.</p>
        {lowPower && (
          <p className="hint" role="status">
            Movement is resting because this device was struggling to keep up. Nothing is hidden.{' '}
            <button type="button" className="quiet" onClick={keepFullMotion}>Use full motion here</button>
          </p>
        )}
      </fieldset>
      )}
      <label className="choice">
        <input type="checkbox" checked={preferences.density === 'compact'} onChange={(event) => setPrefs({ density: event.target.checked ? 'compact' : 'comfortable' })} />
        Compact rows in the {listed(['Library', flagOn('editor') && 'the timeline', flagOn('drafts') && 'drafts'])}
      </label>
      {flagOn('app.command_palette') && <label className="choice">
        <input type="checkbox" checked={preferences.palette} onChange={(event) => setPrefs({ palette: event.target.checked })} />
        Use Ctrl K for search and commands
      </label>}
      {flagOn('app.shortcuts') && <label className="choice">
        <input type="checkbox" checked={preferences.singleKeys} onChange={(event) => setPrefs({ singleKeys: event.target.checked })} />
        Single-key shortcuts such as N and M
      </label>}
      {classicNav && flagOn('app.classic_nav') && <label className="choice">
        <input type="checkbox" checked={preferences.classicNav} onChange={(event) => setPrefs({ classicNav: event.target.checked })} />
        Use the older navigation: {flagOn('discover.word_links') || flagOn('discover.harmonic') ? 'Mixes, Discover and Workshop' : 'Mixes and Workshop'}
      </label>}
    </section>
  );
}
