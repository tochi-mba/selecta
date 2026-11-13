// The venue health grid (ADR-0453 D7, BZ-0453-08): a real ARIA grid, one row per venue and one
// cell per zone, with row and column headers, one tab stop moved by arrow keys, Home and End
// (moveInGrid), sort, filters and search, and fixed-height row windowing so 500 venues stay quick.

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { moveInGrid } from '../../ui/primitives';
import { CONSOLE_COPY } from '../copy/console';
import type { Venue } from '../types';
import { arrangeVenues, DEFAULT_OPTIONS, GridOptions, regionsOf, tagsOf } from './consoleLogic';
import { GridFilters } from './GridFilters';
import { useNowPlayingAnnouncements } from './useNowPlaying';
import { NeedsYouMark, ZoneCellBody } from './ZoneCell';
import './console.css';

export const ROW_HEIGHT = 152;
export const WALL_ROW_HEIGHT = 200;
const HEADER_HEIGHT = 48;
const OVERSCAN = 3;
/** jsdom and a first paint report no height; assume a typical viewport until the browser measures. */
const FALLBACK_VIEWPORT = 600;
const PAGE = 10;

export type VenueHealthGridProps = {
  venues: Venue[];
  now: number;
  offline?: boolean;
  updatedAt?: number | null;
  onOpenVenue?: (venueId: string) => void;
  wall?: boolean;
  /** For tests: the clock announcements are rate-limited against. */
  clock?: () => number;
};

function columnNames(venues: Venue[], count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const names = new Set(venues.map((venue) => venue.zones[index]?.name).filter(Boolean));
    return names.size === 1 ? [...names][0]! : CONSOLE_COPY.zoneColumn(index + 1);
  });
}

export function VenueHealthGrid({ venues, now, offline = false, updatedAt = null, onOpenVenue, wall = false, clock }: VenueHealthGridProps) {
  const [options, setOptions] = useState<GridOptions>(DEFAULT_OPTIONS);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState({ row: 0, column: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const scroller = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const rowHeight = wall ? WALL_ROW_HEIGHT : ROW_HEIGHT;

  const rows = useMemo(() => arrangeVenues(venues, options, now), [venues, options, now]);
  const regions = useMemo(() => regionsOf(venues), [venues]);
  const tags = useMemo(() => tagsOf(venues), [venues]);
  const zoneColumns = Math.max(1, ...venues.map((venue) => venue.zones.length));
  const columns = zoneColumns + 1;
  const headers = useMemo(() => columnNames(venues, zoneColumns), [venues, zoneColumns]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight || FALLBACK_VIEWPORT);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const body = Math.max(rowHeight, viewport - HEADER_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(rows.length, start + Math.ceil(body / rowHeight) + OVERSCAN * 2);
  const shown = rows.slice(start, end);
  const activeRow = Math.min(active.row, Math.max(0, rows.length - 1));
  const tabRow = activeRow >= start && activeRow < end ? activeRow : start;

  useNowPlayingAnnouncements(shown, now, paused || offline, clock);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    scroller.current?.querySelector<HTMLElement>(`[data-cell="${active.row}:${active.column}"]`)?.focus();
  }, [active, start]);

  const reveal = (row: number) => {
    const top = row * rowHeight;
    let next = scrollTop;
    if (top < scrollTop) next = top;
    else if (top + rowHeight > scrollTop + body) next = top + rowHeight - body;
    if (next !== scrollTop) {
      if (scroller.current) scroller.current.scrollTop = next;
      setScrollTop(next);
    }
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const at = { row: activeRow, column: active.column };
    if (event.key === 'Enter' && at.column === 0 && onOpenVenue) {
      event.preventDefault();
      onOpenVenue(rows[at.row].id);
      return;
    }
    let next: { row: number; column: number } | null;
    if (event.key === 'PageDown') next = { row: Math.min(rows.length - 1, at.row + PAGE), column: at.column };
    else if (event.key === 'PageUp') next = { row: Math.max(0, at.row - PAGE), column: at.column };
    else if (event.ctrlKey && event.key === 'Home') next = { row: 0, column: 0 };
    else if (event.ctrlKey && event.key === 'End') next = { row: rows.length - 1, column: columns - 1 };
    else next = moveInGrid(event.key, at, rows.length, columns);
    if (!next) return;
    event.preventDefault();
    pendingFocus.current = true;
    reveal(next.row);
    setActive(next);
  };

  const template = { gridTemplateColumns: `minmax(11rem, 1.3fr) repeat(${zoneColumns}, minmax(0, 1fr))` };

  return <section className="hq-grid-section" aria-labelledby="hq-grid-title" data-wall={wall || undefined}>
    <div className="hq-grid-head">
      <h2 id="hq-grid-title">{CONSOLE_COPY.venuesHeading}</h2>
      <p className="biz-quiet" aria-live="polite">{CONSOLE_COPY.shownCount(rows.length, venues.length)}</p>
      <button type="button" className="hq-pause" aria-pressed={paused} onClick={() => setPaused(!paused)}>{CONSOLE_COPY.pauseAnnouncements}</button>
    </div>
    {!wall && <GridFilters options={options} onChange={(next) => { setOptions(next); setActive({ row: 0, column: active.column }); setScrollTop(0); if (scroller.current) scroller.current.scrollTop = 0; }} regions={regions} tags={tags} />}
    {!rows.length ? <p className="biz-quiet">{CONSOLE_COPY.noMatch}</p> : (
      <div ref={scroller} className="hq-grid-scroll" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div role="grid" aria-label={CONSOLE_COPY.gridLabel} aria-rowcount={rows.length + 1} aria-colcount={columns} className="hq-grid" onKeyDown={keys}>
          <div role="rowgroup" className="hq-grid-headgroup">
            <div role="row" aria-rowindex={1} className="hq-grid-row hq-grid-header" style={template}>
              <div role="columnheader" aria-colindex={1}>{CONSOLE_COPY.venueColumn}</div>
              {headers.map((name, index) => <div role="columnheader" aria-colindex={index + 2} key={index}>{name}</div>)}
            </div>
          </div>
          <div role="rowgroup" className="hq-grid-body" style={{ height: rows.length * rowHeight }}>
            {shown.map((venue, offset) => {
              const row = start + offset;
              const cellProps = (column: number) => ({
                'data-cell': `${row}:${column}`,
                'aria-colindex': column + 1,
                tabIndex: row === tabRow && column === active.column ? 0 : -1,
                onFocus: () => { if (activeRow !== row || active.column !== column) setActive({ row, column }); },
              });
              return <div role="row" aria-rowindex={row + 2} key={venue.id} className="hq-grid-row" data-venue={venue.id} style={{ ...template, top: row * rowHeight, height: rowHeight }}>
                <div role="rowheader" {...cellProps(0)} className="hq-grid-venue" onClick={() => onOpenVenue?.(venue.id)}>
                  <span className="hq-venue-name biz-clamp" title={venue.name}>{venue.name}</span>
                  {venue.region && <span className="biz-quiet">{venue.region}</span>}
                  <NeedsYouMark venue={venue} now={now} />
                </div>
                {Array.from({ length: zoneColumns }, (_, index) => {
                  const zone = venue.zones[index];
                  return <div role="gridcell" key={zone?.id ?? `none-${index}`} {...cellProps(index + 1)}>
                    {zone ? <ZoneCellBody zone={zone} venue={venue} now={now} offline={offline} updatedAt={updatedAt} /> : <span className="biz-quiet">{CONSOLE_COPY.noZone}</span>}
                  </div>;
                })}
              </div>;
            })}
          </div>
        </div>
      </div>
    )}
  </section>;
}
