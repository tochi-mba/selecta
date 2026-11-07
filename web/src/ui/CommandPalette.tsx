import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { navigate } from '../router';
import { Command, matchCommands } from '../shell/commands';
import { Dialog } from './controls';

/** Go anywhere or do something common by typing. Enter runs what's highlighted, and only what's
 * highlighted, and a command that can't run says why instead of doing something else. Everything here
 * has an ordinary way to do it too, so nothing depends on knowing this exists. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [refused, setRefused] = useState('');
  const base = useId();
  const list = useRef<HTMLUListElement>(null);
  const text = query.trim();

  const shown = useMemo<Command[]>(() => {
    const matches = matchCommands(commands, text);
    if (!text) return matches;
    return [...matches, { id: 'search-library', label: `Search your library for “${text}”`, group: 'Go to', run: () => navigate(`/library?q=${encodeURIComponent(text)}&show=all`) }];
  }, [commands, text]);

  useEffect(() => {
    setHighlight(0);
    setRefused('');
  }, [text]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    if (command.unavailable) {
      setRefused(`${command.label}: ${command.unavailable}`);
      return;
    }
    onClose();
    command.run();
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = shown.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length) setHighlight((at) => (event.key === 'ArrowDown' ? (at >= last ? 0 : at + 1) : at <= 0 ? last : at - 1));
      setRefused('');
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setHighlight(event.key === 'Home' ? 0 : Math.max(last, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(shown[highlight]);
    }
  };

  const optionId = (index: number) => `${base}-option-${index}`;
  return (
    <Dialog title="Search and commands" onClose={onClose}>
      <div className="palette">
        <input
          data-autofocus
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={`${base}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? optionId(highlight) : undefined}
          aria-label="Search for a page or a command"
          placeholder="Where to, or what to do?"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keys}
        />
        {refused && <p className="warn" role="status">{refused}</p>}
        {!shown.length && <p className="hint">Nothing matches that.</p>}
        <ul ref={list} id={`${base}-list`} role="listbox" aria-label="Results" className="palette-list">
          {shown.map((command, index) => (
            <li
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === highlight}
              aria-disabled={command.unavailable ? true : undefined}
              className={`palette-item ${index === highlight ? 'on' : ''} ${command.unavailable ? 'off' : ''}`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => run(command)}
            >
              <span>{command.label}</span>
              <small>{command.unavailable ?? command.group}</small>
            </li>
          ))}
        </ul>
        <p className="hint">Arrow keys choose, Enter goes, Escape closes. This never deletes anything or replaces what’s playing.</p>
      </div>
    </Dialog>
  );
}
