import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { ApiError, get, LibraryPage, LibrarySong, MixData, post } from '../api';
import { analysingWords, analysisWords, askedToAnalyse, clock, etaWords } from '../lib';
import { setQuery as setAddressQuery, useQueryParam } from '../router';
import { setPrefs, usePrefs } from '../state/prefs';
import { orderOf, trackReadiness } from '../state/readiness';
import { operationId } from '../state/async';
import { Action, Dialog, Menu, Problem, Skeleton, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SearchField } from '../ui/primitives';
import { ViewProps } from './shared';
import { SongDetails } from './SongDetails';

const FILTERS = [
  { name: 'all', label: 'Everything' },
  { name: 'ready', label: 'Ready' },
  { name: 'not_yet', label: 'Not analysed yet' },
  { name: 'attention', label: 'Needs attention' },
  { name: 'priority', label: 'Priority list' },
  { name: 'set_aside', label: 'Set aside' },
];

const SORTS = [
  { name: 'title', label: 'Title' },
  { name: 'artist', label: 'Artist' },
  { name: 'tempo', label: 'Tempo' },
  { name: 'recent', label: 'Newest first' },
];

const PAGE_SIZE = 100;
// the server's own limit on one page, which keeps refreshing what's on screen cheap
const MOST_REFRESHED = 200;

const pagesFrom = (text: string | null) => {
  const pages = Number(text);
  return Number.isInteger(pages) && pages > 1 ? Math.min(pages, 200) : 1;
};

export function Library({ mix, now, player, setMixData, setView, notify, status, refreshMix, refreshStatus }: ViewProps) {
  const query = useQueryParam('q') ?? '';
  const filter = useQueryParam('show') ?? 'all';
  const sort = useQueryParam('sort') ?? 'title';
  const pagesAsked = useQueryParam('pages');
  const pagesWanted = useRef(pagesFrom(pagesAsked));
  const pagesJustAppended = useRef<number | null>(null);
  // Cursor for each loaded page. Poll whichever deep page is actually in
  // view, not always the last page added (which may be far off screen).
  const pageCursors = useRef<(string | null)[]>([null]);
  // IDs, not row positions, identify a page: cursor pages can overlap during
  // background analysis, and deduplicating rows changes their index.
  const pageBySong = useRef(new Map<number, number>());
  const listRef = useRef<HTMLUListElement>(null);
  pagesWanted.current = pagesFrom(pagesAsked);
  const [typed, setTyped] = useState(query);
  const [searching, setSearching] = useState(true);
  useEffect(() => setTyped(query), [query]);
  const [rows, setRows] = useState<LibrarySong[] | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<number | null>(null);
  const preferences = usePrefs();
  const line = status.analysing ?? [];
  const asked = useRef(0);
  // Keep old search pages out of the committed result list while a newer URL
  // query/filter/sort is loading. This is distinct from refreshing the same list.
  const searchIdentity = JSON.stringify([query, filter, sort]);
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null);
  const committedRows = searchIdentity === resolvedIdentity ? rows : null;

  const url = useCallback((after?: string | null, limit = PAGE_SIZE) => {
    const params = new URLSearchParams({ q: query, state: filter, sort, limit: String(limit) });
    if (after) params.set('after', after);
    return `/library?${params}`;
  }, [query, filter, sort]);

  // Only the newest search can answer, however the answers arrive. Coming back to a list that had been
  // shown further down loads as many pages as it had, one after another, in the same order.
  const load = useCallback(async () => {
    asked.current += 1;
    const mine = asked.current;
    try {
      const found = new Map<number, LibrarySong>();
      const pagesBySong = new Map<number, number>();
      const cursors: (string | null)[] = [];
      let after: string | null = null;
      let count = 0;
      for (let page = 0; page < pagesWanted.current; page += 1) {
        cursors.push(after);
        const answer: LibraryPage = await get<LibraryPage>(url(after));
        if (mine !== asked.current) return;
        for (const song of answer.songs) {
          found.set(song.id, song);
          if (!pagesBySong.has(song.id)) pagesBySong.set(song.id, page);
        }
        count = answer.total;
        after = answer.next;
        if (!after) break;
      }
      setSearching(false);
      setResolvedIdentity(JSON.stringify([query, filter, sort]));
      setRows([...found.values()]);
      setTotal(count);
      setNext(after);
      pageCursors.current = cursors;
      pageBySong.current = pagesBySong;
      setFailed(false);
    } catch {
      if (mine === asked.current) {
        setFailed(true);
        setSearching(false);
      }
    }
  }, [url, query, filter, sort]);

  const more = async () => {
    const mine = asked.current;
    const cursor = next;
    const page = await get<LibraryPage>(url(cursor));
    if (mine !== asked.current) return;
    const pageIndex = pageCursors.current.length;
    pageCursors.current = [...pageCursors.current, cursor];
    for (const song of page.songs) {
      if (!pageBySong.current.has(song.id)) pageBySong.current.set(song.id, pageIndex);
    }
    setRows((before) => {
      const known = new Set(before?.map((song) => song.id));
      return [...(before ?? []), ...page.songs.filter((song) => !known.has(song.id))];
    });
    setNext(page.next);
    setTotal(page.total);
    const newPageCount = pagesWanted.current + 1;
    // Already merged the fetched page locally. Do not refetch all earlier pages
    // just because the shareable URL now records this scroll depth.
    pagesJustAppended.current = newPageCount;
    setAddressQuery({ pages: String(newPageCount) });
  };

  // Find the visible row in logarithmic time, not by assuming 100
  // rendered rows per page. Adjacent cursor pages can contain the same ID,
  // and very long song titles can make rows different heights.
  const visiblePage = () => {
    const items = listRef.current?.children;
    if (!items?.length) return 0;
    let low = 0;
    let high = items.length - 1;
    const viewLine = Math.min(window.innerHeight / 3, 240);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const item = items[middle] as HTMLElement;
      if (item.getBoundingClientRect().bottom < viewLine) low = middle + 1;
      else high = middle;
    }
    return Number((items[low] as HTMLElement).dataset.libraryPage ?? '0');
  };

  // Refresh the first two pages and the page the listener is viewing; never
  // poll all 20k rows. Merge by stable ID, even when songs reorder during analysis.
  const refreshShown = useCallback(() => {
    if (searching || rows === null) return Promise.resolve();
    const mine = asked.current;
    const loaded = rows.length;
    const requests = [
      get<LibraryPage>(url(null, Math.min(Math.max(loaded, PAGE_SIZE), MOST_REFRESHED))),
    ];
    const page = visiblePage();
    const deepCursor = page >= 2 ? pageCursors.current[page] : null;
    if (deepCursor) {
      requests.push(get<LibraryPage>(url(deepCursor, PAGE_SIZE)));
    }
    return Promise.all(requests).then((pages) => {
      if (mine !== asked.current) return;
      setFailed(false);
      setTotal(pages[0].total);
      setRows((before) => {
        if (!before) return pages[0].songs;
        const fresh = new Map(pages.flatMap((page) => page.songs).map((song) => [song.id, song]));
        return before.map((song) => fresh.get(song.id) ?? song);
      });
    }).catch(() => { if (mine === asked.current) setFailed(true); });
  }, [url, rows?.length, searching]);

  useEffect(() => {
    // Deep links and Back/Forward may change only "pages", without changing
    // search or sort. That still must restore the corresponding loaded subset.
    if (pagesJustAppended.current === pagesFrom(pagesAsked)) {
      pagesJustAppended.current = null;
      return;
    }
    pagesJustAppended.current = null;
    pageCursors.current = [null];
    setSearching(true);
    const wait = window.setTimeout(() => void load(), 120);
    return () => { asked.current += 1; window.clearTimeout(wait); };
  }, [load, pagesAsked]);

  // The active page refreshes during analysis; a hidden tab does no work and
  // catches up as soon as it becomes visible again.
  useVisiblePoll(refreshShown, line.length ? 4000 : 15000);

  useEffect(() => {
    if (typed === query) return;
    const wait = window.setTimeout(() => setAddressQuery({ q: typed || null, pages: null }), 200);
    return () => window.clearTimeout(wait);
  }, [typed, query]);

  const inMix = new Set(mix.map((item) => item.song_id));
  const add = async (song: LibrarySong, position?: number) => {
    // "play next" means next in what's on screen, so it stops if that's changed
    const guard = position === undefined ? undefined : { 'x-mix-order': orderOf(mix) };
    setMixData(await post<MixData>('/mix/songs', { song_id: song.id, position }, guard));
    notify(position !== undefined ? `${song.title} plays next.` : `Added ${song.title}.`, true);
  };
  const never = async (song: LibrarySong) => {
    await post(`/songs/${song.id}/never`);
    notify(song.never ? `${song.title} can play again.` : `${song.title} won’t be picked for mixes.`);
    await load();
  };
  const [building, setBuilding] = useState(false);
  const buildingNow = useRef(false);
  const hereNow = useRef(true);
  useEffect(() => {
    hereNow.current = true;
    return () => { hereNow.current = false; };
  }, []);
  const buildOperations = useRef(new Map<string, string>());
  const [confirmStart, setConfirmStart] = useState<{ song: LibrarySong; order: string } | null>(null);
  const startFrom = async (song: LibrarySong, expectedOrder = orderOf(mix)) => {
    // Two different rows can be clicked before React paints the busy state.
    if (buildingNow.current) return;
    buildingNow.current = true;
    setBuilding(true);
    const signature = JSON.stringify([song.id, expectedOrder]);
    const operation = buildOperations.current.get(signature) ?? operationId('build');
    buildOperations.current.set(signature, operation);
    try {
      const data = await post<MixData>(`/vibes/pick/build?start=${song.id}`, undefined, {
        'x-mix-order': expectedOrder,
        'x-operation-id': operation,
      });
      buildOperations.current.delete(signature);
      setMixData(data);
      if (hereNow.current) {
        setView('Now');
        void player.playFrom(0);
        notify(`A mix starting from ${song.title}.`, true);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) buildOperations.current.delete(signature);
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      if (hereNow.current) notify((error as Error).message || 'Couldn’t build that mix. Try again.');
    } finally {
      buildingNow.current = false;
      setBuilding(false);
    }
  };
  const requestStart = (song: LibrarySong) => {
    // A new mix takes over the current one. Ask consistently with Explore
    // rather than replacing live music directly from a Library row.
    if (mix.length > 0 && now.phase !== 'idle') {
      setConfirmStart({ song, order: orderOf(mix) });
      return;
    }
    return startFrom(song);
  };
  const left = Math.max(status.counts.music - status.counts.analysed, 0);
  const analyseAll = async () => {
    await post('/analysis/start');
    refreshStatus();
    notify('Analysing the rest of your library in the background.');
  };
  const analyse = async (song: LibrarySong) => {
    const { ahead, seconds } = await post<{ ahead: number; seconds?: number }>(`/songs/${song.id}/analyse`);
    refreshStatus();
    notify(askedToAnalyse(song.title, ahead, seconds));
  };
  const setPriority = async (song: LibrarySong) => {
    await post(`/songs/${song.id}/priority?priority=${song.priority ? 0 : 100}`);
    notify(song.priority ? `${song.title} moved to background processing.` : `${song.title} moved to the priority list.`);
    await load();
  };
  const shownDetails = rows?.find((song) => song.id === opened) ?? null;
  // One pass rather than comparing every row against every other row: long
  // libraries can reach 20,000 songs, and identical titles must still select
  // the correct ID without a quadratic render or name collisions.
  const duplicateIds = useMemo(() => {
    const firstByName = new Map<string, number>();
    const duplicates = new Set<number>();
    for (const song of rows ?? []) {
      const identity = JSON.stringify([song.title, song.artist]);
      const first = firstByName.get(identity);
      if (first !== undefined) {
        duplicates.add(first);
        duplicates.add(song.id);
      } else firstByName.set(identity, song.id);
    }
    return duplicates;
  }, [rows]);
  const { counts } = status;
  const compact = preferences.density === 'compact';

  return (
    <main className="page library density" id="main">
      <header className="library-head">
        <h1 className="display small">Library</h1>
        <p className="library-summary">
          {Number.isFinite(counts.ready) && <span><b>{counts.ready}</b> ready for mixes</span>}
          <span><b>{counts.analysed}</b> analysed</span>
          <span><b>{counts.music}</b> songs</span>
          {!!counts.set_aside && <span><b>{counts.set_aside}</b> set aside</span>}
        </p>
      </header>
      <div className="library-find">
        <SearchField label="Search your library" value={typed} onChange={setTyped} placeholder="Search by artist or title" />
        <label className="library-sort">
          Sort by
          <select value={sort} onChange={(event) => setAddressQuery({ sort: event.target.value === 'title' ? null : event.target.value, pages: null }, { push: true })}>
            {SORTS.map((option) => <option key={option.name} value={option.name}>{option.label}</option>)}
          </select>
        </label>
        <div className="row library-density" role="group" aria-label="Row size">
          <button aria-pressed={!compact} onClick={() => setPrefs({ density: 'comfortable' })}>Comfortable</button>
          <button aria-pressed={compact} onClick={() => setPrefs({ density: 'compact' })}>Compact</button>
        </div>
      </div>
      <div className="chips" role="group" aria-label="Show">
        {FILTERS.map((option) => (
          <button key={option.name} aria-pressed={filter === option.name} onClick={() => setAddressQuery({ show: option.name === 'all' ? null : option.name, pages: null }, { push: true })}>
            {option.label}
          </button>
        ))}
      </div>
      {filter === 'not_yet' && left > 0 && (
        <div className="row wrap analyse-all">
          <span className="hint">
            {left} song{left === 1 ? '' : 's'} left. {analysisWords(status.eta?.analysis)}
          </span>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <Action run={analyseAll}>Analyse them all</Action>
          )}
        </div>
      )}
      {searching && committedRows !== null && <p className="hint" role="status">Updating results…</p>}
      {failed && committedRows === null && <Problem retry={load}>Couldn’t load your library. Your songs are fine.</Problem>}
      {failed && committedRows !== null && <p className="warn" role="status">Can’t check on your library right now, so what’s shown may be out of date.</p>}
      {committedRows === null && !failed && <Skeleton variant="library" lines={6} label="Loading your songs" />}
      {committedRows !== null && <p className="hint library-count" role="status">{committedRows.length < total ? `Showing ${committedRows.length} of ${total} songs.` : `${total} song${total === 1 ? '' : 's'}.`}</p>}
      {committedRows?.length === 0 && !failed && (
        <section className="empty-state">
          <h2>{query ? `Nothing matches “${query}”.` : 'No songs in this view'}</h2>
          <p>Try a different title or artist, or show all songs to check their progress.</p>
          <div className="row wrap">
            {query && <button onClick={() => { setTyped(''); setAddressQuery({ q: null, pages: null }); }}>Clear search</button>}
            {filter !== 'all' && <button onClick={() => setAddressQuery({ show: null, pages: null }, { push: true })}>Show all songs</button>}
          </div>
        </section>
      )}
      {!!committedRows?.length && (
        <div className="library-column-head" aria-hidden="true">
          <span>Song and artist</span>
          <span>Tempo · Key · Length</span>
          <span>Mix readiness</span>
          <span>Actions</span>
        </div>
      )}
      <ul ref={listRef} className="rows library-rows" aria-busy={searching}>
        {committedRows?.map((song) => {
          const facts = trackReadiness(song);
          const already = inMix.has(song.id);
          const title = song.title ?? 'Untitled';
          const duplicate = duplicateIds.has(song.id);
          const name = duplicate ? `${title} (song ${song.id})` : title;
          return (
            <li key={song.id} data-library-page={pageBySong.current.get(song.id) ?? 0} className={`song-row ${song.never ? 'never' : ''}`}>
              <div className="song-name">
                <button className="link song-open" onClick={() => setOpened(song.id)} aria-label={`Details for ${name}`}>
                  <b title={title}>{title}</b>
                </button>
                <span title={song.artist ?? 'Unknown artist'}>{song.artist ?? 'Unknown artist'}</span>
              </div>
              <small className="facts song-columns">
                <span>{song.bpm !== null ? `${Math.round(song.bpm)} BPM` : 'Not analysed'}</span>
                <span>{song.camelot ?? '–'}</span>
                <span>{clock(song.duration)}</span>
                {song.lyric_status === 'synced' && <span>lyrics</span>}
              </small>
              <div className="song-readiness">
                <Status kind={facts.kind}>{facts.words}</Status>
                {facts.reason && !facts.canStartMix && <small className="hint song-why">{facts.reason}</small>}
              </div>
              <div className="song-actions">
                {facts.canStartMix && <Action title="Build a mix that starts here" working="Building your mix…" disabled={building || searching} run={() => requestStart(song)}>Start a mix</Action>}
                {facts.canAdd && <Action className="song-add" working="Adding…" disabled={already || searching} run={() => add(song)}>{already ? 'In the mix' : 'Add'}</Action>}
                {facts.canAdd && now.phase !== 'idle' && <Action working="Adding…" disabled={already || searching} run={() => add(song, now.position + 1)}>Play next</Action>}
                {facts.canAnalyse && (
                  <Action disabled={line.includes(song.id)} run={() => analyse(song)}>
                    {analysingWords(line, song.id)}
                    {status.eta?.line[song.id] !== undefined && `, ${etaWords(status.eta.line[song.id])}`}
                  </Action>
                )}
                {!facts.setAside && (
                  <Menu label={<><Icon name="more" /><span className="visually-hidden">More actions for {name}</span></>}>
                    <Action role="menuitemcheckbox" aria-checked={song.priority} run={() => setPriority(song)} title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup">
                      {song.priority ? 'Priority: on' : 'Prioritize'}
                    </Action>
                    <Action role="menuitemcheckbox" aria-checked={song.never} run={() => never(song)} title="Selecta won’t pick this when it builds a mix">
                      {song.never ? 'Never: on' : 'Never play'}
                    </Action>
                  </Menu>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {next && <Action className="library-more" working="Loading…" run={more}>Show more songs</Action>}
      {shownDetails && <SongDetails song={shownDetails} onClose={() => setOpened(null)} onChanged={() => void load()} notify={notify} onPriority={setPriority} onNever={never} />}
      {confirmStart && (
        <Dialog
          title="Replace your current mix?"
          onClose={() => setConfirmStart(null)}
          footer={(
            <>
              <button onClick={() => setConfirmStart(null)}>Keep current mix</button>
              <Action className="primary" working="Building…" run={async () => {
                const selected = confirmStart;
                setConfirmStart(null);
                await startFrom(selected.song, selected.order);
              }}>Replace and play</Action>
            </>
          )}
        >
          <p>Starting a mix from <b>{confirmStart.song.title ?? 'this song'}</b> replaces your current mix. What is playing now will stop when the new mix starts.</p>
          <p className="hint">Your saved drafts are not affected. Cancel to keep listening.</p>
        </Dialog>
      )}
    </main>
  );
}
