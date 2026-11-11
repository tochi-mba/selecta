import { setPrefs, Theme, usePrefs } from '../state/prefs';
import { Menu } from './controls';
import { Icon, IconName } from './Icon';
import { words } from '../copy';

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', get label() { return words().themeMatchSystem; } },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const iconFor = (theme: Theme): IconName => (theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'system');

/** Light, dark, or following the computer. It changes straight away, is kept in this browser, and has
 * no effect on music, mixes or anything on the server. */
export function ThemeMenu({ className = '' }: { className?: string }) {
  const { theme } = usePrefs();
  const current = THEMES.find((option) => option.id === theme);
  return (
    <Menu
      className={`theme-menu ${className}`}
      title={`Theme: ${current?.label}`}
      label={<><Icon name={iconFor(theme)} /><span className="visually-hidden">Theme: {current?.label}</span></>}
    >
      {THEMES.map((option) => (
        <button key={option.id} role="menuitemradio" aria-checked={theme === option.id} onClick={() => setPrefs({ theme: option.id })}>
          <Icon name={iconFor(option.id)} /> {option.label}
        </button>
      ))}
    </Menu>
  );
}

/** The same choice laid out in full, for the settings in Workspace. */
export function ThemeChoices() {
  const { theme } = usePrefs();
  return (
    <fieldset className="theme-choices">
      <legend>Theme</legend>
      <div className="chips" role="radiogroup" aria-label="Theme">
        {THEMES.map((option) => (
          <label className="choice" key={option.id}>
            <input type="radio" name="selecta-theme" checked={theme === option.id} onChange={() => setPrefs({ theme: option.id })} />
            <Icon name={iconFor(option.id)} /> {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
