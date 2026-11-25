import { useId, useState, useSyncExternalStore } from 'react';
import { words } from '../copy';
import { flagOn } from '../flags';
import { listed } from '../shell/manifest';
import { changedPrefs, DEFAULT_PREFS, type Prefs, resetPrefs, setPrefs, type Theme, usePrefs } from '../state/prefs';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { keepFullMotion, useLowPowerLevel } from '../ui/lowPower';
import { THEMES, ThemeChoices } from '../ui/ThemeChoice';
import { feelParts, onFeelChange } from '../feel/root';

/** How this looks and behaves in this browser. Nothing here touches music, mixes or the server, so
 * any of it can be switched back, including the older navigation if the new one ever gets in the way.
 * `classicNav` is false where the older navigation has no pages to lead to (browser-first Cloud). */
/** What each setting is called, and its default in words, for the reset confirmation. */
const SETTING_WORDS: Record<keyof Prefs, (value: Prefs[keyof Prefs]) => string> = {
  theme: (value) => (value === 'system' ? words().themeCommand : `Theme: ${value}`),
  motion: (value) => `Motion: ${String(value)[0].toUpperCase()}${String(value).slice(1)}`,
  railCollapsed: (value) => `Side menu: ${value ? 'collapsed' : 'open'}`,
  density: (value) => `Rows: ${value}`,
  libraryLayout: (value) => `Library: ${value === 'cards' ? 'cards' : 'list'}`,
  palette: (value) => `Ctrl K: ${value ? 'on' : 'off'}`,
  singleKeys: (value) => `Single-key shortcuts: ${value ? 'on' : 'off'}`,
  classicNav: (value) => `Older navigation: ${value ? 'on' : 'off'}`,
  termHints: (value) => `Hints beside music terms: ${value ? 'on' : 'off'}`,
  haptics: (value) => `Vibrate on press: ${value ? 'on' : 'off'}`,
};

/** The vibration switch only means something on a touch phone whose browser can buzz (in practice
 * Android; ADR-0477), so nowhere else is it offered. */
function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    && typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}

const MOTION_NAMES = { still: 'Still', subtle: 'Subtle', expressive: 'Expressive' } as const;
const MOTION_ABOUT = {
  still: 'Nothing moves by itself.',
  subtle: 'Short, gentle movement.',
  expressive: 'Springs, lifts and the odd small celebration.',
} as const;

/** The palettes a theme card draws. System shows both halves, because it follows the computer. */
const PANES: Record<Theme, ('light' | 'dark')[]> = { system: ['light', 'dark'], light: ['light'], dark: ['dark'] };

/** A small drawing of a page in one theme: a header, two rows and the main button, in that theme's
 * own colours (feel-account.css), so the choice can be seen before it is made. Decoration only: the
 * card's name says which theme it is. */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span className="ic-preview" aria-hidden="true">
      {PANES[theme].map((pane) => (
        <span key={pane} className="ic-pane" data-pane={pane}>
          <i className="ic-pane-bar" />
          <i className="ic-pane-row" />
          <i className="ic-pane-row" />
          <i className="ic-pane-button" />
        </span>
      ))}
    </span>
  );
}

/** With the feel on, theme and motion are chosen from cards: each theme card shows a small page in
 * its colours, and each motion card, when pointed at or focused, moves a dot the way that level moves
 * (Still never moves it). The radios and their names are the same as the plain chips'. */
function ChoiceCards({ kind }: { kind: 'theme' | 'motion' }) {
  const preferences = usePrefs();
  const id = useId();
  if (kind === 'theme') {
    return (
      <div className="ic-cards" role="radiogroup" aria-label="Theme">
        {THEMES.map((option) => (
          <label className="ic-card" key={option.id} data-lift="">
            <ThemePreview theme={option.id} />
            <span className="ic-card-name">
              <input type="radio" name="selecta-theme" checked={preferences.theme === option.id} onChange={() => setPrefs({ theme: option.id })} />
              {option.label}
            </span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className="ic-cards" role="radiogroup" aria-label="Motion">
      {(['still', 'subtle', 'expressive'] as const).map((motion) => (
        <label className="ic-card" key={motion} data-lift="">
          <span className="ic-motion-demo" data-level={motion} data-motion-preview={motion} aria-hidden="true"><i /></span>
          <span className="ic-card-name">
            <input type="radio" name="selecta-motion" aria-label={MOTION_NAMES[motion]} aria-describedby={`${id}-${motion}`} checked={preferences.motion === motion} onChange={() => setPrefs({ motion })} />
            {MOTION_NAMES[motion]}
          </span>
          <span className="ic-card-about" id={`${id}-${motion}`}>{MOTION_ABOUT[motion]}</span>
        </label>
      ))}
    </div>
  );
}

export function InterfaceChoices({ classicNav = true }: { classicNav?: boolean } = {}) {
  const preferences = usePrefs();
  const lowPower = useLowPowerLevel();
  const [resetting, setResetting] = useState(false);
  const changed = changedPrefs();
  // any part of the feel on: the choices become cards; with every app.feel_* flag off, the chips
  const alive = useSyncExternalStore(onFeelChange, () => feelParts().length > 0, () => false);
  return (
    <section className="panel stack interface-choices">
      <h2>Interface</h2>
      <p className="hint">These are kept in this browser. None of them change your music or your mixes.</p>
      {flagOn('app.theme_choice') && (alive
        ? <fieldset className="theme-choices"><legend>Theme</legend><ChoiceCards kind="theme" /></fieldset>
        : <ThemeChoices />)}
      {flagOn('app.motion_choice') && (
      <fieldset className="theme-choices">
        <legend>Motion</legend>
        {alive ? <ChoiceCards kind="motion" /> : (
          <div className="chips" role="radiogroup" aria-label="Motion">
            {(['still', 'subtle', 'expressive'] as const).map((motion) => (
              <label className="choice" key={motion}>
                <input type="radio" name="selecta-motion" checked={preferences.motion === motion} onChange={() => setPrefs({ motion })} />
                {MOTION_NAMES[motion]}
              </label>
            ))}
          </div>
        )}
        <p className="hint">Still stops decorative movement. Your computer’s reduced-motion setting always takes priority.</p>
        {lowPower === 'auto' && (
          <p className="hint" role="status">
            Movement is resting because this device was struggling to keep up. Nothing is hidden.{' '}
            <button type="button" className="quiet" onClick={keepFullMotion}>Use full motion here</button>
          </p>
        )}
        {lowPower === 'lite' && (
          <p className="hint" role="status">
            Some effects are lighter because this device was working hard: no glow, blur or beat effects, and gentler movement. Nothing is hidden.{' '}
            <button type="button" className="quiet" onClick={keepFullMotion}>Use full motion here</button>
          </p>
        )}
      </fieldset>
      )}
      <label className="choice">
        <input type="checkbox" checked={preferences.density === 'compact'} onChange={(event) => setPrefs({ density: event.target.checked ? 'compact' : 'comfortable' })} />
        Compact rows in the {listed(['Library', flagOn('editor') && 'the timeline', flagOn('drafts') && 'drafts'])}
      </label>
      {flagOn('app.feel_haptics') && canVibrate() && <label className="choice">
        <input type="checkbox" checked={preferences.haptics} onChange={(event) => setPrefs({ haptics: event.target.checked })} />
        Vibrate gently when you press things
      </label>}
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
      {changed.length > 0 && <p><button type="button" onClick={() => setResetting(true)}>Reset to defaults</button></p>}
      {resetting && (
        <ConfirmDialog
          title="Reset these settings to their defaults?"
          body={<><p>These change back:</p><ul>{changed.map((key) => <li key={key}>{SETTING_WORDS[key](DEFAULT_PREFS[key])}</li>)}</ul><p>Your music and mixes are not touched.</p></>}
          confirmLabel="Reset to defaults"
          cancelLabel="Keep my settings"
          onConfirm={() => resetPrefs()}
          onClose={() => setResetting(false)}
        />
      )}
    </section>
  );
}
