import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { navigate } from '../router';
import { Command, matchCommands } from '../shell/commands';
import { Dialog } from './controls';
import { usePaletteSongs } from './paletteSongs';

/** Groups in the order they're shown: songs first, then the places and actions. Searching the whole
 * library for what was typed always comes last, after everything that matched it. */
const GROUPS: Command['group'][] = ['Songs', 'Your drafts', 'Go to', 'Playback', 'Do'];
const SEARCH_LIBRARY = 'search-library';
/** What each kind of result is, said before its name, so a song can't be mistaken for a page. */
const KIND: Record<Command['group'], string> = { Songs: 'Song', 'Your drafts': 'Draft', 'Go to': 'Page', Playback: 'Playback', Do: 'Action' };
const kindOf = (command: Command) => (command.id === SEARCH_LIBRARY ? 'Search' : KIND[command.group]);

/** Go anywhere or do something common by typing. Enter runs what's highlighted, and only what's
 * highlighted, and a command that can't run says why instead of doing something else. Everything here
 * has an ordinary way to do it too, so nothing depends on knowing this exists. Songs found here only
 * ever open their details in the Library: choosing one never plays or changes anything. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  // What's highlighted is remembered by what it is, so results arriving above it can't move Enter
  // onto something else. The position is only used when that thing has gone from the list.
  const [highlight, setHighlight] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const [refused, setRefused] = useState('');
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const text = query.trim();
  const songs = usePaletteSongs(text);

  const shown = useMemo<Command[]>(() => {
    const matches = matchCommands(commands, text);
    const grouped = GROUPS.filter((group) => group !== 'Songs').flatMap((group) => matches.filter((command) => command.group === group));
    const everywhere: Command[] = text
      ? [{ id: SEARCH_LIBRARY, label: `Search your library for “${text}”`, group: 'Go to', run: () => navigate(`/library?q=${encodeURIComponent(text)}&show=all`) }]
      : [];
    return [...songs.commands, ...grouped, ...everywhere];
  }, [commands, text, songs.commands]);

  const found = highlight.id === null ? -1 : shown.findIndex((command) => command.id === highlight.id);
  const activeIndex = found >= 0 ? found : Math.min(highlight.index, Math.max(0, shown.length - 1));
  const activeId = shown[activeIndex]?.id ?? null;

  useEffect(() => {
    setHighlight({ id: null, index: 0 });
    setRefused('');
  }, [text]);

  // Hold on to whatever is highlighted now, by name, before anything else can arrive above it.
  useEffect(() => {
    if (activeId !== null && activeId !== highlight.id) setHighlight({ id: activeId, index: activeIndex });
  }, [activeId, activeIndex, highlight.id]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, shown.length]);

  const moveTo = (index: number) => setHighlight({ id: shown[index]?.id ?? null, index });

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
      if (shown.length) moveTo(event.key === 'ArrowDown' ? (activeIndex >= last ? 0 : activeIndex + 1) : activeIndex <= 0 ? last : activeIndex - 1);
      setRefused('');
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : Math.max(last, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(shown[activeIndex]);
    }
  };

  const optionId = (index: number) => `${base}-option-${index}`;
  // runs of the same group, in the order shown; the library search on its own, with no heading
  const sections: { group: Command['group'] | null; items: { command: Command; index: number }[] }[] = [];
  shown.forEach((command, index) => {
    const group = command.id === SEARCH_LIBRARY ? null : command.group;
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.items.push({ command, index });
    else sections.push({ group, items: [{ command, index }] });
  });
  const option = ({ command, index }: { command: Command; index: number }) => (
    <li
      key={command.id}
      id={optionId(index)}
      role="option"
      // the kind comes first, so a song is never heard as a page or an action
      aria-label={`${kindOf(command)}: ${command.label}${command.unavailable ? `. ${command.unavailable}` : command.detail ? `. ${command.detail}` : ''}`}
      aria-selected={index === activeIndex}
      aria-disabled={command.unavailable ? true : undefined}
      className={`palette-item ${index === activeIndex ? 'on' : ''} ${command.unavailable ? 'off' : ''}`}
      onMouseEnter={() => moveTo(index)}
      onClick={() => run(command)}
    >
      <bdi>{command.label}</bdi>
      <small>{command.unavailable ?? (command.detail ? `${command.group} · ${command.detail}` : command.group)}</small>
    </li>
  );
  return (
    <Dialog title="Search and commands" onClose={onClose}>
      <div className="palette">
        <input
          data-autofocus
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={`${base}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? optionId(activeIndex) : undefined}
          aria-label="Search for a page or a command"
          placeholder="A song, a page, or what to do"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keys}
        />
        {refused && <p className="warn" role="status">{refused}</p>}
        {songs.failed && <p className="hint">Songs couldn’t be searched just now. Pages and commands still work.</p>}
        {!shown.length && <p className="hint">Nothing matches that.</p>}
        <div ref={list} id={`${base}-list`} role="listbox" aria-label="Results" className="palette-list">
          {sections.map(({ group, items }) => (group === null ? (
            <ul key="everywhere" role="none" className="palette-group">{items.map(option)}</ul>
          ) : (
            <ul key={group} role="group" aria-labelledby={`${base}-group-${KIND[group]}`} className="palette-group">
              <li role="presentation" id={`${base}-group-${KIND[group]}`} className="palette-group-name">{group}</li>
              {items.map(option)}
            </ul>
          )))}
        </div>
        <p className="hint">Arrow keys choose, Enter goes, Escape closes. This never deletes anything or replaces what’s playing. A song opens its details; it doesn’t play.</p>
      </div>
    </Dialog>
  );
}
