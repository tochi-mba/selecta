import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { ApiError, get, LibraryPage, LibrarySong, MixData, post, problemKind } from '../api';
import { Gate, useFlags, visible } from '../flags';
import { analysingWords, analysisWords, askedToAnalyse, clock, etaWords } from '../lib';
import { setQuery as setAddressQuery, useQueryParam } from '../router';
import { setPrefs, usePrefs } from '../state/prefs';
import { orderOf, trackReadiness } from '../state/readiness';
import { operationId } from '../state/async';
import { Action, Dialog, Menu, Problem, Skeleton, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';
import { SearchField } from '../ui/primitives';
import { ViewProps } from './shared';
import { SongDetails } from './SongDetails';

const FILTERS: ({ name: string; label: string } & Gate)[] = [
  { name: 'all', label: 'Everything' },
  { name: 'ready', label: 'Ready' },
  { name: 'not_yet', label: 'Not analysed yet' },
  { name: 'attention', label: 'Needs attention' },
  { name: 'priority', label: 'Priority list', flag: 'library.priority' },
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

/** LX-0341-02: a count from the server, or plainly "not known yet" when the server didn't say. */
function Counter({ value, words }: { value: number | undefined; words: string }) {
  return Number.isFinite(value)
    ? <span><b>{(value as number).toLocaleString()}</b> {words}</span>
    : <span>{words[0].toUpperCase() + words.slice(1)}: <b>not known yet</b></span>;
}

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
  const selectionEntryRef = useRef<HTMLButtonElement>(null);
  pagesWanted.current = pagesFrom(pagesAsked);
  const [typed, setTyped] = useState(query);
  const [searching, setSearching] = useState(true);
  useEffect(() => setTyped(query), [query]);
  const [rows, setRows] = useState<LibrarySong[] | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // T0013: a server fault says so, apart from a dropped connection
  const [serverFault, setServerFault] = useState(false);
  const [pageProblem, setPageProblem] = useState('');
  const [opened, setOpened] = useState<number | null>(null);
  const preferences = usePrefs();
  const line = status.analysing ?? [];
  const asked = useRef(0);
  // Keep old search pages out of the committed result list while a newer URL
  // query/filter/sort is loading. This is distinct from refreshing the same list.
  const searchIdentity = JSON.stringify([query, filter, sort]);
  // Selection is scoped to the exact loaded result depth as well as search/sort.
  const selectionIdentity = JSON.stringify([query, filter, sort, pagesAsked]);
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null);
  const committedRows = searchIdentity === resolvedIdentity ? rows : null;
  // A selection belongs to an exact search/filter/sort result. Changing any
  // dimension invalidates it rather than selecting a different filtered row.
  const [batchSelection, setBatchSelection] = useState<{ identity: string; ids: number[] }>({ identity: '', ids: [] });
  const selectedIds = batchSelection.identity === selectionIdentity ? batchSelection.ids : [];
  // A selected set keeps 20k-item row scans O(n), not O(n × 200), as playback updates arrive.
  const selectedIdSet = useMemo(() => new Set(selectedIds), [batchSelection, selectionIdentity]);
  type BatchAction = 'prioritize' | 'deprioritize' | 'never' | 'allow';
  const [confirmBatch, setConfirmBatch] = useState<{
    action: BatchAction; identity: string;
    songs: { id: number; title: string; artist: string; priority: boolean; never: boolean }[];
  } | null>(null);
  const visibleSelected = useMemo(() => (committedRows ?? []).filter((song) => selectedIdSet.has(song.id)), [committedRows, selectedIdSet]);
  // GP-0258-03: Shift with a checkbox selects every loaded recording between the last one chosen and
  // this one, in the order shown, never past the 200 limit. The anchor is read outside the updater.
  const lastToggled = useRef<number | null>(null);
  const toggleBatch = (id: number, range = false) => {
    const anchor = lastToggled.current;
    lastToggled.current = id;
    const order = (committedRows ?? []).map((song) => song.id);
    const from = anchor === null ? -1 : order.indexOf(anchor);
    const to = order.indexOf(id);
    setBatchSelection((before) => {
      const ids = before.identity === selectionIdentity ? before.ids : [];
      if (range && from >= 0 && to >= 0 && from !== to) {
        const next = [...ids];
        for (const songId of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (!next.includes(songId) && next.length < 200) next.push(songId);
        }
        return { identity: selectionIdentity, ids: next };
      }
      return { identity: selectionIdentity, ids: ids.includes(id) ? ids.filter((known) => known !== id) : ids.length >= 200 ? ids : [...ids, id] };
    });
  };
  const askBatch = (action: BatchAction) => {
    if (!visibleSelected.length || searching || failed) return;
    setConfirmBatch({
      action, identity: selectionIdentity,
      songs: visibleSelected.map((song) => ({
        id: song.id, title: song.title ?? 'Untitled', artist: song.artist ?? 'Unknown artist',
        priority: song.priority, never: song.never,
      })),
    });
  };
  const applyBatch = async () => {
    const wanted = confirmBatch;
    if (!wanted || wanted.identity !== selectionIdentity || searching || failed) {
      setConfirmBatch(null);
      return;
    }
    await post('/library/batch', {
      action: wanted.action,
      entries: wanted.songs.map((song) => ({
        id: song.id,
        expected: wanted.action === 'prioritize' || wanted.action === 'deprioritize' ? song.priority : song.never,
      })),
    });
    setConfirmBatch(null);
    setBatchSelection({ identity: selectionIdentity, ids: [] });
    window.requestAnimationFrame(() => selectionEntryRef.current?.focus());
    // GP-0258-07: Undo is offered only for songs this batch really changed, and puts back exactly
    // those. The server refuses it whole if any of them has changed again since.
    const priority = wanted.action === 'prioritize' || wanted.action === 'deprioritize';
    const target = wanted.action === 'prioritize' || wanted.action === 'never';
    const changedSongs = wanted.songs.filter((song) => (priority ? song.priority : song.never) !== target);
    const inverse = { prioritize: 'deprioritize', deprioritize: 'prioritize', never: 'allow', allow: 'never' }[wanted.action];
    notify(`Updated ${wanted.songs.length} precisely selected recordings.`, changedSongs.length ? async () => {
      await post('/library/batch', { action: inverse, entries: changedSongs.map((song) => ({ id: song.id, expected: target })) });
      await load();
    } : undefined);
    await load();
  };


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
      setPageProblem('');
    } catch (error) {
      if (mine === asked.current) {
        setFailed(true);
        setServerFault(problemKind(error) === 'server');
        setSearching(false);
      }
    }
  }, [url, query, filter, sort]);

  const more = async () => {
    const mine = asked.current;
    const cursor = next;
    if (!cursor || searching) return;
    setPageProblem('');
    try {
      const page = await get<LibraryPage>(url(cursor));
      if (mine !== asked.current) return;
      // The last page removes "Show more songs". If it had focus, hand focus to the first song that
      // just arrived, so a keyboard user carries on from where the new songs start (SF-0226-05).
      const fromMore = !page.next && !!document.activeElement?.closest('.library-more');
      const firstNew = page.songs.find((song) => !pageBySong.current.has(song.id));
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
      if (fromMore && firstNew) {
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-focus-key="song-details-${firstNew.id}"]`)?.focus());
      }
    } catch {
      // Keep the successful pages and cursor intact so the same page can be retried.
      if (mine === asked.current) setPageProblem('Couldn’t load more songs. The recordings already shown are unchanged.');
    }
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
  // LX-0341-02: an unknown count stays unknown; it never turns into a made-up zero or NaN
  const left = Number.isFinite(status.counts.music) && Number.isFinite(status.counts.analysed)
    ? Math.max(status.counts.music - status.counts.analysed, 0) : 0;
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
  // A recording link may refer to an ID outside the current filtered or paginated rows.
  // Resolve that exact ID separately: never substitute a same-title recording.
  const songAsked = useQueryParam('song');
  const songWanted = songAsked && /^\d+$/.test(songAsked) && Number.isSafeInteger(Number(songAsked)) && Number(songAsked) > 0
    ? Number(songAsked) : null;
  const [linkedSong, setLinkedSong] = useState<LibrarySong | null>(null);
  const [linkProblem, setLinkProblem] = useState<'missing' | 'unavailable' | null>(null);
  const [linkRetry, setLinkRetry] = useState(0);
  const openedFromAddress = useRef<number | null>(null);
  useEffect(() => {
    // Back/Forward must not leave the previously linked recording open.
    const previous = openedFromAddress.current;
    if (previous !== null && previous !== songWanted) {
      setOpened((current) => current === previous ? null : current);
    }
    openedFromAddress.current = songWanted;
    let live = true;
    setLinkedSong(null);
    setLinkProblem(null);
    if (songWanted === null || committedRows === null) return;
    if (committedRows.some((song) => song.id === songWanted)) {
      setOpened(songWanted);
      return;
    }
    // Numeric search ranks an exact recording ID ahead of titles or artists.
    // The API's normal all-music view also bypasses a stale UI filter.
    void get<LibraryPage>(`/library?q=${songWanted}&state=all&limit=1`)
      .then((page) => {
        if (!live) return;
        const exact = page.songs.find((song) => song.id === songWanted);
        if (exact) {
          setLinkedSong(exact);
          setOpened(songWanted);
        } else setLinkProblem('missing');
      })
      .catch(() => { if (live) setLinkProblem('unavailable'); });
    return () => { live = false; };
    // A refreshed row list does not need to refetch the same deep link.
  }, [songWanted, searchIdentity, resolvedIdentity, linkRetry]);
  // LX-0349-05: a change made in the open sheet can move its song out of the current view (This is
  // music, from Set aside). The sheet stays open on that same recording, read afresh by its ID, so
  // the way back (Let Selecta decide) is still right there.
  useEffect(() => {
    if (opened === null || rows === null || rows.some((song) => song.id === opened) || linkedSong?.id === opened) return;
    let live = true;
    void get<LibraryPage>(`/library?q=${opened}&state=all&limit=1`)
      .then((page) => {
        const exact = page.songs.find((song) => song.id === opened);
        if (live && exact) setLinkedSong(exact);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [rows, opened, linkedSong]);
  const lastShown = useRef<LibrarySong | null>(null);
  const shownDetails = rows?.find((song) => song.id === opened)
    ?? (linkedSong?.id === opened ? linkedSong : null)
    // while that fresh read is on its way, the sheet keeps what it last showed rather than vanishing
    ?? (lastShown.current?.id === opened ? lastShown.current : null);
  lastShown.current = shownDetails;
  const closeDetails = () => {
    setOpened(null);
    setLinkedSong(null);
    if (songAsked !== null) setAddressQuery({ song: null });
  };
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
  // LX-0340-05: a title shared by different artists names the artist in every button, so no two
  // buttons for different recordings ever read the same to a screen reader
  const sharedTitles = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const song of rows ?? []) {
      const title = song.title ?? 'Untitled';
      if (seen.has(title)) shared.add(title);
      seen.add(title);
    }
    return shared;
  }, [rows]);
  const { counts } = status;
  const compact = preferences.density === 'compact';
  const on = useFlags();
  const cardLayout = preferences.libraryLayout === 'cards' && on('library.card_view');
  // batch actions need at least one thing they can do
  const batch = on('library.batch') && (on('library.priority') || on('library.never_play'));

  return (
    <main className="page library density" id="main">
      <header className="library-head">
        <h1 className="display small">Library</h1>
        <p className="library-summary">
          <Counter value={counts.ready} words="ready for mixes" />
          <Counter value={counts.analysed} words="analysed" />
          <Counter value={counts.music} words="songs" />
          {/* LX-0341-07: an attention count opens exactly the songs it counts */}
          {!!counts.set_aside && Number.isFinite(counts.set_aside) && (
            <button type="button" className="link library-summary-link"
              onClick={() => setAddressQuery({ show: 'set_aside', pages: null }, { push: true })}>
              <b>{counts.set_aside.toLocaleString()}</b> set aside
            </button>
          )}
        </p>
        <p className="library-readiness-help">Analysed means audio has been measured. Ready for mixes means a song has the cues needed to plan a mix; it does not mean transitions are already rendered.</p>
      </header>
      <div className="library-find">
        <SearchField label="Search your library" value={typed} onChange={setTyped} placeholder="Search titles, artists, remixes, credits or recording ID" />
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
        {on('library.card_view') && (
          <div className="row library-layout" role="group" aria-label="Library layout">
            <button type="button" aria-pressed={!cardLayout} onClick={() => setPrefs({ libraryLayout: 'list' })}>List view</button>
            <button type="button" aria-pressed={cardLayout} onClick={() => setPrefs({ libraryLayout: 'cards' })}>Card view</button>
          </div>
        )}
      </div>
      <div className="chips library-filters" role="group" aria-label="Filter Library recordings">
        {visible(FILTERS).map((option) => (
          <button key={option.name} aria-pressed={filter === option.name} onClick={() => setAddressQuery({ show: option.name === 'all' ? null : option.name, pages: null }, { push: true })}>
            {option.label}
          </button>
        ))}
        {(filter !== 'all' || query) && <button type="button" className="quiet" onClick={() => { setTyped(''); setAddressQuery({ q: null, show: null, pages: null }, { push: true }); }}>Clear all filters</button>}
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
      {/* LX-0342-01: the count comes straight after the filters, ahead of the selection tools, so on a
          phone it is still on screen beside the search that changed it */}
      {committedRows !== null && <p className="hint library-count" role="status">{committedRows.length < total ? `Showing ${committedRows.length} of ${total} songs.` : `${total} song${total === 1 ? '' : 's'}.`}</p>}
      {batch && committedRows !== null && committedRows.length > 0 && filter !== 'set_aside' && (
        <section className="library-batch" aria-label="Select Library recordings">
          <div className="row wrap">
            <button ref={selectionEntryRef} disabled={searching || failed} onClick={() => setBatchSelection({
              identity: selectionIdentity,
              ids: committedRows.slice(0, 200).map((song) => song.id),
            })}>Select up to 200 loaded songs</button>
            {visibleSelected.length === 0 && <span className="hint">Or use the checkboxes beside recordings to select them individually. Shift selects a range.</span>}
          </div>
          {visibleSelected.length > 0 && (
            <div className="library-batch-actions" aria-label="Actions for selected loaded recordings">
              <p className="hint" role="status">{visibleSelected.length} of {committedRows.length} loaded recordings selected (limit 200). Search, filter or sort changes clear selection; batch changes never move or delete audio.</p>
              <div className="row wrap">
                <button onClick={() => {
                  setBatchSelection({ identity: selectionIdentity, ids: [] });
                  selectionEntryRef.current?.focus();
                }}>Clear selection</button>
                {on('library.priority') && (
                  <>
                    <button disabled={searching || failed} onClick={() => askBatch('prioritize')}>Prioritize selected</button>
                    <button disabled={searching || failed} onClick={() => askBatch('deprioritize')}>Remove priority</button>
                  </>
                )}
                {on('library.never_play') && (
                  <>
                    <button disabled={searching || failed} onClick={() => askBatch('never')}>Never play selected</button>
                    <button disabled={searching || failed} onClick={() => askBatch('allow')}>Allow selected</button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      )}
      {searching && committedRows !== null && <p className="hint" role="status">Updating results…</p>}
      {failed && committedRows === null && <Problem retry={load}><span>Couldn’t load your library. Your songs are fine.</span>{serverFault && <span className="library-fault"> Something went wrong inside Selecta, not your connection.</span>}</Problem>}
      {failed && committedRows !== null && <div className="row wrap" role="status"><span className="warn">Can’t check on your library right now, so what’s shown may be out of date.</span><Action working="Retrying…" run={load}>Retry loading</Action></div>}
      {committedRows === null && !failed && <Skeleton variant={cardLayout ? 'cards' : 'library'} lines={6} label="Loading your songs" retry={() => void load()} />}
      {committedRows?.length === 0 && !failed && (
        <section className="empty-state">
          <h2>{query ? `Nothing matches “${query}”.` : counts.music === 0 && filter === 'all' ? 'Your library is empty' : filter === 'ready' ? 'No songs are ready for mixes yet' : 'No songs in this view'}</h2>
          <p>{counts.music === 0 && !query && filter === 'all' ? 'Add a folder with local music to begin. The original audio stays in place while Selecta scans and analyses it.' : filter === 'ready' && !query ? 'A song becomes ready for mixes once Selecta has analysed it. Show all songs to see how far each one has got.' : 'Try a different title, artist, recording ID or spelling, or show all songs to check their progress. Approximate matches must be checked before selecting a recording.'}</p>
          {/* LX-0343-07: say which constraints are hiding songs, so clearing them is a known step */}
          {(query || filter !== 'all') && (
            <p className="hint library-active-constraints">
              Looking in: {FILTERS.find((option) => option.name === filter)?.label ?? filter}{query ? `, searching for “${query}”` : ''}.
            </p>
          )}
          <div className="row wrap">
            {counts.music === 0 && !query && filter === 'all' && <button onClick={() => setView('Workshop')}>Add music</button>}
            {query && <button onClick={() => { setTyped(''); setAddressQuery({ q: null, pages: null }); }}>Clear search</button>}
            {filter !== 'all' && <button onClick={() => setAddressQuery({ show: null, pages: null }, { push: true })}>Show all songs</button>}
          </div>
        </section>
      )}
      {!!committedRows?.length && !cardLayout && (
        <div className="library-column-head" aria-hidden="true">
          <span>Song and artist</span>
          <span>Tempo · Key · Length</span>
          <span>Mix readiness</span>
          <span>Actions</span>
        </div>
      )}
      <ul ref={listRef} className={`rows library-rows ${cardLayout ? 'library-cards' : ''}`} aria-busy={searching}>
        {committedRows?.map((song) => {
          const facts = trackReadiness(song);
          const already = inMix.has(song.id);
          const title = song.title ?? 'Untitled';
          const duplicate = duplicateIds.has(song.id);
          const name = duplicate ? `${title} (song ${song.id})` : title;
          const spoken = duplicate || !sharedTitles.has(title) ? name : `${title} by ${song.artist ?? 'Unknown artist'}`;
          return (
            <li key={song.id} data-library-page={pageBySong.current.get(song.id) ?? 0} className={`song-row ${song.never ? 'never' : ''} ${selectedIdSet.has(song.id) ? 'selected' : ''}`}>
              <div className="song-name">
                {batch && filter !== 'set_aside' && <label className="library-batch-check">
                  <input type="checkbox" aria-label={`Select recording ${name} by ${song.artist ?? 'Unknown artist'}, ID ${song.id}`}
                    checked={selectedIdSet.has(song.id)} disabled={searching || selectedIdSet.size >= 200 && !selectedIdSet.has(song.id)}
                    // a failed refresh holds the choice without disabling the box, so focus stays on it (MP-0297-03)
                    aria-disabled={failed || undefined}
                    onChange={(event) => { if (!failed) toggleBatch(song.id, (event.nativeEvent as MouseEvent).shiftKey === true); }} />
                </label>}
                <button className="link song-open" onClick={() => { if (songAsked !== null) setAddressQuery({ song: null }); setOpened(song.id); }} aria-label={`Details for ${spoken}`} data-focus-key={`song-details-${song.id}`}>
                  <SongMotif songId={song.id} /><b dir="auto" title={title}>{title}</b>
                </button>
                <span dir="auto" title={song.artist ?? 'Unknown artist'}>{song.artist ?? 'Unknown artist'}</span>
                {duplicate && <small className="library-recording-id">Recording {song.id}</small>}
                {query && song.match && <small className="hint" aria-label={`Search match: ${song.match}`}>{song.match}</small>}
              </div>
              <small className="facts song-columns">
                <span>{song.bpm !== null ? `${Math.round(song.bpm)} BPM` : 'Not analysed'}</span>
                {/* LX-0344-03: an unknown key says so, rather than leaving a bare dash */}
                <span>{song.camelot ?? (song.bpm !== null ? 'Key unknown' : 'No key yet')}</span>
                <span>{clock(song.duration)}</span>
                {on('lyrics.lookup') && song.lyric_status === 'synced' && <span>lyrics</span>}
              </small>
              <div className="song-readiness">
                <Status kind={facts.kind}>{facts.words}</Status>
                {facts.reason && !facts.canStartMix && <small className="hint song-why">{facts.reason}</small>}
              </div>
              <div className="song-actions">
                {facts.canStartMix && <Action title="Build a mix that starts here" working="Building your mix…" disabled={building || searching} run={() => requestStart(song)}>Start a mix</Action>}
                {facts.canAnalyse && (
                  <Action disabled={line.includes(song.id)} working="Asking…" run={() => analyse(song)}>
                    {song.readiness?.status === 'needs_attention' && !line.includes(song.id) ? 'Try analysing again' : analysingWords(line, song.id)}
                    {status.eta?.line[song.id] !== undefined && `, ${etaWords(status.eta.line[song.id])}`}
                  </Action>
                )}
                {((!facts.setAside && (on('library.priority') || on('library.never_play'))) || facts.canAdd) && (
                  <Menu title={`More actions for ${spoken}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {spoken}</span></>}>
                    {facts.canAdd && <Action role="menuitem" disabled={already || searching} run={() => add(song)} title="Puts it at the end of the current mix. Nothing starts playing.">{already ? 'Already in current mix' : 'Add to current mix'}</Action>}
                    {facts.canAdd && now.phase !== 'idle' && <Action role="menuitem" disabled={already || searching} run={() => add(song, now.position + 1)} title="Puts it straight after the song playing now. What's playing carries on.">Play next in current mix</Action>}
                    {!facts.setAside && on('library.priority') && <Action role="menuitemcheckbox" aria-checked={song.priority} run={() => setPriority(song)} title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup">
                      {song.priority ? 'Priority: on' : 'Prioritize'}
                    </Action>}
                    {!facts.setAside && on('library.never_play') && <Action role="menuitemcheckbox" aria-checked={song.never} run={() => never(song)} title="Selecta won’t pick this when it builds a mix">
                      {song.never ? 'Never: on' : 'Never play'}
                    </Action>}
                  </Menu>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {pageProblem && <p role="alert" className="warn">{pageProblem}</p>}
      {next && <Action className="library-more" disabled={searching} working="Loading…" run={more}>{pageProblem ? 'Retry showing more songs' : 'Show more songs'}</Action>}
      {songAsked !== null && songWanted === null && (
        <p role="status" className="hint">That recording link is invalid. <button type="button" onClick={closeDetails}>Dismiss</button></p>
      )}
      {songWanted !== null && linkProblem && (
        <p role="status" className="hint">
          {linkProblem === 'missing' ? 'That exact recording is no longer available in your Library.' : 'Couldn’t open that recording. Check your connection to Selecta.'}
          {' '}<button type="button" onClick={() => setLinkRetry((attempt) => attempt + 1)}>Try again</button>
          {' '}<button type="button" onClick={closeDetails}>Dismiss</button>
        </p>
      )}
      {shownDetails && <SongDetails song={shownDetails} onClose={closeDetails} onChanged={() => void load()} notify={notify} onPriority={setPriority} onNever={never} />}
      {confirmBatch && <Dialog title="Apply batch Library action?" onClose={() => setConfirmBatch(null)}
        footer={<>
          <button onClick={() => setConfirmBatch(null)}>Cancel - change nothing</button>
          <Action className="primary" working="Updating selected recordings…" run={applyBatch}>Confirm {confirmBatch.songs.length} recordings</Action>
        </>}>
        <p>You are about to <b>{confirmBatch.action === 'never' ? 'exclude from future mixes' : confirmBatch.action === 'allow' ? 'allow in future mixes' : confirmBatch.action === 'prioritize' ? 'prioritize for analysis' : 'remove analysis priority from'}</b> precisely {confirmBatch.songs.length} recording{confirmBatch.songs.length === 1 ? '' : 's'}.</p>
        <p className="hint">Only these exact song IDs will be changed. If any were changed in another tab or scan, the entire action is refused. Original audio and current mix are untouched.</p>
        <ul className="batch-preview">{confirmBatch.songs.slice(0, 15).map((song) =>
          <li key={song.id}>{song.title} - {song.artist} (ID {song.id}; priority {song.priority ? 'on' : 'off'}; excluded {song.never ? 'yes' : 'no'})</li>
        )}</ul>
        {confirmBatch.songs.length > 15 && <p>…and {confirmBatch.songs.length - 15} more selected recordings.</p>}
      </Dialog>}
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
