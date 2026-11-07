import { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { PageLink } from '../shell/PageLink';
import { Icon, IconName } from './Icon';

/** The smaller building blocks. Each one has one job and one way of behaving, so every page gets the
 * same keyboard handling, names and error wiring without having to think about it. */

/** A button that shows only an icon. Its name is required, so it can never be unlabelled. */
export function IconButton({ icon, label, className = '', ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { icon: IconName; label: string }) {
  return (
    <button {...rest} className={`icon-button ${className}`} aria-label={label} title={rest.title ?? label}>
      <Icon name={icon} />
    </button>
  );
}

/** Subpages with real addresses: links, not tabs, so Back, reload and sharing a link all work. */
export function LinkTabs({ label, items, current }: { label: string; items: { path: string; label: string }[]; current: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <PageLink key={item.path} to={item.path} aria-current={current === item.path ? 'page' : undefined}>{item.label}</PageLink>
      ))}
    </nav>
  );
}

/** Tabs inside a panel, following the ARIA pattern: one tab stop, arrows move, the panel follows. */
export function Tabs<T extends string>({ label, tabs, current, onChange, children }: { label: string; tabs: { id: T; label: string }[]; current: T; onChange: (tab: T) => void; children: ReactNode }) {
  const base = useId();
  const keys = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + last) % tabs.length : null;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(tabs[target].id);
    document.getElementById(`${base}-${tabs[target].id}`)?.focus();
  };
  return (
    <>
      <div className="inspector-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            role="tab"
            id={`${base}-${tab.id}`}
            aria-controls={`${base}-${tab.id}-panel`}
            aria-selected={current === tab.id}
            tabIndex={current === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => keys(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-${current}-panel`} aria-labelledby={`${base}-${current}`} tabIndex={0}>{children}</div>
    </>
  );
}

/** A label, the control, help and any error, joined up so a screen reader hears all of it. */
export function Field({ label, help, error, children, className = '' }: { label: ReactNode; help?: ReactNode; error?: string; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode; className?: string }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const described = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {help && <p className="field-help" id={helpId}>{help}</p>}
      {error && <p className="warn" id={errorId} role="alert">{error}</p>}
    </div>
  );
}

/** A labelled search box with a way to clear it. Escape clears it too, and never leaves the page. */
export function SearchField({ label, value, onChange, placeholder, onEscape, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { label: string; value: string; onChange: (value: string) => void; onEscape?: () => void }) {
  const box = useRef<HTMLInputElement>(null);
  return (
    <div className="search-field">
      <Icon name="search" />
      <input
        {...rest}
        ref={box}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation();
            onChange('');
          } else if (event.key === 'Escape') {
            onEscape?.();
          }
          rest.onKeyDown?.(event);
        }}
      />
      {value && <IconButton icon="close" label={`Clear ${label.toLowerCase()}`} type="button" onClick={() => { onChange(''); box.current?.focus(); }} />}
    </div>
  );
}

/** A range with a spoken value, so it says "about 8 GB" rather than a bare number. */
export function Slider({ label, valueText, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; valueText?: string }) {
  return <input {...rest} type="range" aria-label={label} aria-valuetext={valueText} />;
}

/** A small non-modal panel that opens under a button. Escape and clicking away close it, and focus
 * goes back to the button. */
export function Popover({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div
      className={`popover ${className}`}
      ref={holder}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          opener.current?.focus();
        }
      }}
    >
      <button ref={opener} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div id={id} className="popover-panel">{children}</div>}
    </div>
  );
}

/** One thing in a Menu. Its own label, and it says when it's dangerous. */
export function MenuItem({ children, danger, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return <button {...rest} role="menuitem" className={`${danger ? 'destructive' : ''} ${rest.className ?? ''}`}>{children}</button>;
}

/** Arrow keys around a grid with one tab stop, for anything laid out in rows and columns. */
export function moveInGrid(key: string, at: { row: number; column: number }, rows: number, columns: number, firstColumn = 0): { row: number; column: number } | null {
  const steps: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
  if (key === 'Home') return { row: at.row, column: firstColumn };
  if (key === 'End') return { row: at.row, column: columns - 1 };
  const step = steps[key];
  if (!step) return null;
  return {
    row: Math.min(Math.max(at.row + step[0], 0), rows - 1),
    column: Math.min(Math.max(at.column + step[1], firstColumn), columns - 1),
  };
}
