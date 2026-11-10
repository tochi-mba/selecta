import { KeyboardEvent, ReactNode, useId, useState } from 'react';
import { Field } from './primitives';

/**
 * T0030: the shared text input, select and combobox. Each is built on `Field`, so its label, help and
 * error are always joined to the control and a screen reader hears all of them. Buttons are `Action`
 * (controls.tsx) and `IconButton`, and the range is `Slider` (primitives.tsx).
 */

type Common = { label: ReactNode; help?: ReactNode; error?: string; disabled?: boolean; className?: string };

/** A labelled one-line text box. */
export function TextField({ label, help, error, disabled, className, value, onChange, placeholder, required, type = 'text' }: Common & {
  value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; type?: 'text' | 'email' | 'url' | 'number';
}) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      {(props) => (
        <input {...props} type={type} value={value} placeholder={placeholder} required={required} aria-required={required || undefined} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

export type Choice<T extends string> = { value: T; label: string; disabled?: boolean };

/** A labelled native select. Its choices are words, never colour or position alone. */
export function Select<T extends string>({ label, help, error, disabled, className, value, options, onChange }: Common & {
  value: T; options: Choice<T>[]; onChange: (value: T) => void;
}) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      {(props) => (
        <select {...props} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/**
 * A text box that suggests choices as you type (the ARIA 1.2 combobox pattern). Arrow keys move
 * through the suggestions without leaving the box, Enter picks one, and Escape closes the list or,
 * when it's already closed, clears the text.
 */
export function Combobox<T extends string>({ label, help, error, disabled, className, value, onChange, options, onPick, empty = 'Nothing matches' }: Common & {
  value: string; onChange: (value: string) => void; options: Choice<T>[]; onPick: (value: T) => void; empty?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = options.filter((option) => !option.disabled);
  const pick = (option: Choice<T>) => {
    onPick(option.value);
    onChange(option.label);
    setOpen(false);
    setActive(-1);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shown.length) return setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setOpen(true);
      setActive((at) => (at < 0 ? (step > 0 ? 0 : shown.length - 1) : (at + step + shown.length) % shown.length));
    } else if (event.key === 'Enter' && open && active >= 0 && shown[active]) {
      event.preventDefault();
      pick(shown[active]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      if (open) setOpen(false);
      else onChange('');
      setActive(-1);
    }
  };
  const optionId = (index: number) => `${listId}-option-${index}`;
  return (
    <Field label={label} help={help} error={error} className={`combobox ${className ?? ''}`}>
      {(props) => (
        <>
          <input
            {...props}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
            onKeyDown={keys}
            onBlur={() => setOpen(false)}
          />
          <ul id={listId} role="listbox" hidden={!open}>
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => { event.preventDefault(); pick(option); }}
              >
                {option.label}
              </li>
            ))}
            {!shown.length && <li role="presentation">{empty}</li>}
          </ul>
        </>
      )}
    </Field>
  );
}
