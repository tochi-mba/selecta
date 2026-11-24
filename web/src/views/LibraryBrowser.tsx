import { ReactNode, Ref, useContext } from 'react';
import { HolderContext } from '../devices/controller';
import { Icon } from '../ui/Icon';
import { SearchField } from '../ui/primitives';

/** The Library's frame in browser-first Cloud: a page header with quiet counts and the one main
 * action, a single toolbar, a selection bar that exists only while something is selected, and
 * empty states with one way forward. Local mode keeps its own frame in `Library.tsx`; these parts
 * render only when the Cloud shell passes `browser`. */
export type LibraryBrowserChrome = {
  /** the page's main action, drawn at the end of the header (Connect music) */
  action: ReactNode;
};

const figure = (value: number | undefined) => (Number.isFinite(value) ? (value as number).toLocaleString() : null);

export function BrowserLibraryHead({ songs, playable, setAside, action, onSetAside }: {
  songs: number | undefined;
  playable: number | undefined;
  setAside: number | undefined;
  action: ReactNode;
  onSetAside: () => void;
}) {
  const total = figure(songs);
  const here = figure(playable);
  // ADR-0475 R6: where the music is, when that is another of this person's devices
  const holder = useContext(HolderContext);
  return (
    <header className="page-header" data-remote={holder ? '' : undefined}>
      <div className="page-header-text">
        <h1 className="display small">Library</h1>
        {/* I83: with another device holding music, the Library is the whole account's */}
        <p className="page-lead">{holder ? 'Your songs, and where each one plays.' : 'Your songs, and which of them can play on this device.'}</p>
        <p className="lw-stats">
          {total !== null && <span className="lw-total"><b>{total}</b> {songs === 1 ? 'song' : 'songs'}</span>}
          {holder && <span data-testid="library-holder">{songs !== undefined && holder.songs >= songs ? <>All on <b>{holder.name}</b></> : <><b>{holder.songs.toLocaleString()}</b> on {holder.name}</>}</span>}
          {/* a remote with none of the music says nothing about it here; the line below says it */}
          {here !== null && (holder ? playable !== 0 && <span><b>{here}</b> on this device</span> : <span><b>{here}</b> ready to play here</span>)}
          {!!setAside && Number.isFinite(setAside) && (
            <button type="button" className="link" onClick={onSetAside}><b>{setAside.toLocaleString()}</b> set aside</button>
          )}
        </p>
      </div>
      <div className="page-header-actions">{action}</div>
    </header>
  );
}

export function BrowserLibraryToolbar({ typed, onTyped, filters, filter, onFilter, sorts, sort, onSort, cards, onCards, cardsOffered }: {
  typed: string;
  onTyped: (value: string) => void;
  filters: { name: string; label: string }[];
  filter: string;
  onFilter: (name: string) => void;
  sorts: { name: string; label: string }[];
  sort: string;
  onSort: (name: string) => void;
  cards: boolean;
  onCards: (cards: boolean) => void;
  cardsOffered: boolean;
}) {
  return (
    <div className="lw-toolbar">
      <SearchField label="Search your library" value={typed} onChange={onTyped} placeholder="Search songs and artists" />
      <div className="lw-chips" role="group" aria-label="Show">
        {filters.map((option) => (
          <button key={option.name} type="button" aria-pressed={filter === option.name} onClick={() => onFilter(option.name)}>{option.label}</button>
        ))}
      </div>
      <div className="lw-toolbar-end">
        <label className="lw-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSort(event.target.value)}>
            {sorts.map((option) => <option key={option.name} value={option.name}>{option.label}</option>)}
          </select>
        </label>
        {cardsOffered && (
          <div className="lw-segment" role="group" aria-label="View">
            <button type="button" aria-pressed={!cards} aria-label="List view" title="List view" onClick={() => onCards(false)}><Icon name="library" size="toolbar" /></button>
            <button type="button" aria-pressed={cards} aria-label="Card view" title="Card view" onClick={() => onCards(true)}><Icon name="mixes" size="toolbar" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The line under the toolbar: how many songs are shown, and the way into selecting. Once
 * something is selected it becomes the selection bar, with what can be done to the selection. */
export function BrowserLibraryMeta({ countWords, updating, selected, canSelect, selectRef, onSelectAll, onClear, children }: {
  countWords: string;
  updating: boolean;
  selected: number;
  canSelect: boolean;
  selectRef: Ref<HTMLButtonElement>;
  onSelectAll: () => void;
  onClear: () => void;
  /** the actions for the selection */
  children: ReactNode;
}) {
  return (
    <div className="lw-meta" data-selecting={selected > 0 || undefined}>
      {/* stays mounted so a screen reader hears each new count */}
      <p className="library-count" role="status">{selected > 0 ? `${selected.toLocaleString()} selected` : updating && countWords ? 'Updating…' : countWords}</p>
      {selected > 0 && <div className="lw-meta-actions" role="group" aria-label="Actions for the selected songs">{children}</div>}
      {canSelect && (
        <div className="lw-meta-end">
          <button ref={selectRef} type="button" className="quiet" onClick={onSelectAll}>Select all</button>
          {selected > 0 && <button type="button" className="quiet" onClick={onClear}>Clear</button>}
        </div>
      )}
    </div>
  );
}

export function BrowserLibraryEmpty({ query, filterLabel, onClearSearch, onShowAll }: {
  query: string;
  /** the filter's label, or null when everything is shown */
  filterLabel: string | null;
  onClearSearch: () => void;
  onShowAll: () => void;
}) {
  return (
    <section className="empty-state boxed" aria-labelledby="library-no-results">
      <span className="empty-state-icon" aria-hidden="true"><Icon name={query ? 'search' : 'music'} /></span>
      <h2 id="library-no-results">{query ? `No songs match “${query}”` : `No songs in ${filterLabel ?? 'this view'}`}</h2>
      <p>{query
        ? filterLabel ? `Looking in ${filterLabel}. Check the spelling, or search all your songs.` : 'Check the spelling, or try the artist instead.'
        : 'Show all songs to see the rest of your library.'}</p>
      <div className="empty-state-actions">
        {query && <button type="button" className={filterLabel ? undefined : 'primary'} onClick={onClearSearch}>Clear search</button>}
        {filterLabel && <button type="button" className="primary" onClick={onShowAll}>Show all songs</button>}
      </div>
    </section>
  );
}
