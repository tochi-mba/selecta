import { useId } from 'react';
import { PREFERENCE } from './stemsCopy';
import type { StemPreferenceValue } from './types';

const VALUES: readonly StemPreferenceValue[] = ['never', 'sometimes', 'often'];

/** Make a Mix shaping: how often a browser mix may use stem moves, Never, Sometimes or Often, as
 * local mode's "Stem-assisted moves" (views/MixSetup.tsx), in the same `mix-steering` section so
 * it looks the same. Nothing with the flag off. `ready` false keeps the choice and says it takes
 * effect once the splitter is downloaded. */
export function StemPreference({ enabled, value, onChange, ready = true, disabled = false }: {
  enabled: boolean;
  value: StemPreferenceValue;
  onChange: (value: StemPreferenceValue) => void;
  ready?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  if (!enabled) return null;
  return (
    <section className="mix-steering" aria-label="Stem transition controls">
      <label htmlFor={id}>{PREFERENCE.label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value as StemPreferenceValue)}
      >
        {VALUES.map((option) => <option key={option} value={option}>{PREFERENCE.options[option]}</option>)}
      </select>
      <p className="hint" id={hintId}>
        {PREFERENCE.hint}{!ready && ` ${PREFERENCE.notReady}`}
      </p>
    </section>
  );
}
