import { ReactNode, RefObject, useLayoutEffect, useRef } from 'react';
import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from './exitMotion';
import { useMediaQuery } from './useMediaQuery';

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Right-align numbers so they line up. */
  numeric?: boolean;
};

/**
 * A plain, accessible data table: a caption, column headers, and an empty state that says so in
 * words. Rows are chosen with an optional button in the first cell, never by clicking a whole row,
 * so keyboard and screen-reader users get the same affordance.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, empty = 'Nothing to show.', onPick, pickLabel, stacked = false }: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  onPick?: (row: T) => void;
  pickLabel?: (row: T) => string;
  /** Stacked mode (ADR-0453 D5): each row becomes a card with labelled values. `true` always,
   * `'auto'` below 600 px, `false` (the default) never, so existing tables render as before. */
  stacked?: boolean | 'auto';
}) {
  const narrow = useMediaQuery('(max-width: 599px)');
  const keys = rows.map(rowKey);
  const fresh = useFreshRows(keys);
  const body = useRef<HTMLElement>(null);
  useGlide(body, keys);
  if (stacked === true || (stacked === 'auto' && narrow)) {
    return (
      <div className="data-table-wrap data-table-stacked-wrap" role="region" aria-label={`${caption} table`}>
        <p className="data-table-stacked-caption">{caption}</p>
        {rows.length === 0 ? <p className="data-table-empty">{empty}</p> : (
          <ul className="data-table-stacked" ref={body as RefObject<HTMLUListElement>}>
            {rows.map((row) => (
              <li key={rowKey(row)} className={fresh.has(rowKey(row)) ? 'data-table-card feel-flash' : 'data-table-card'} data-lift>
                <dl>
                  {columns.map((column, index) => {
                    const value = column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '');
                    const cell = index === 0 && onPick ? <button className="data-table-pick" onClick={() => onPick(row)} aria-label={pickLabel?.(row)}>{value}</button> : value;
                    return <div key={column.key} className="data-table-field"><dt>{column.label}</dt><dd>{cell}</dd></div>;
                  })}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    // Focusable and named, so a keyboard user can scroll a wide table sideways on a phone.
    <div className="data-table-wrap" role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={column.numeric ? 'numeric' : undefined}>{column.label}</th>)}</tr>
        </thead>
        <tbody ref={body as RefObject<HTMLTableSectionElement>}>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="data-table-empty">{empty}</td></tr>}
          {rows.map((row) => (
            <tr key={rowKey(row)} data-lift="row" className={fresh.has(rowKey(row)) ? 'feel-flash' : undefined}>
              {columns.map((column, index) => {
                const value = column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '');
                const cell = index === 0 && onPick ? <button className="data-table-pick" onClick={() => onPick(row)} aria-label={pickLabel?.(row)}>{value}</button> : value;
                return <td key={column.key} className={column.numeric ? 'numeric' : undefined}>{cell}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** At most this many rows glide at once; a longer reorder simply lands. */
const GLIDE_LIMIT = 40;

/** ADR-0477 (plan 3.0 "Lists and tables"): when the same rows come back in a new order (a sort, a
 * row moved up), each one glides from where it was to where it now is instead of jumping. Where a
 * row sat is remembered after every commit, as its distance from the top of the list, so scrolling
 * in between does not matter. Rows are drawn in key order, so the n-th row is the n-th key. Only
 * with the feel's motion on and nothing asking for calm; a row that is new or gone is left alone
 * (new rows already glow, styles/feel.css .feel-flash). Transform only, on the snappy spring. */
function useGlide(list: RefObject<HTMLElement | null>, keys: string[]) {
  const was = useRef<{ order: string; tops: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const node = list.current;
    const order = keys.join('\u0000');
    if (!node) {
      was.current = null;
      return;
    }
    const items = [...node.children].filter((item): item is HTMLElement => item instanceof HTMLElement && !item.querySelector('.data-table-empty'));
    const tops = new Map<string, number>();
    items.forEach((item, index) => { if (keys[index] !== undefined) tops.set(keys[index], item.offsetTop); });
    const before = was.current;
    was.current = { order, tops };
    if (!before || before.order === order || !feelOn('motion') || feelCalm() || typeof Element.prototype.animate !== 'function') return;
    const duration = motionMs('--motion-spring-snappy', 320);
    if (!duration) return;
    const curve = getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim() || 'ease-out';
    let moved = 0;
    items.forEach((item, index) => {
      const from = before.tops.get(keys[index]);
      const to = tops.get(keys[index]);
      if (from === undefined || to === undefined || Math.abs(from - to) < 1 || moved >= GLIDE_LIMIT) return;
      moved += 1;
      const frames = [{ transform: `translateY(${from - to}px)` }, { transform: 'translateY(0)' }];
      try {
        item.animate(frames, { duration, easing: curve });
      } catch {
        item.animate(frames, { duration, easing: 'ease-out' });
      }
    });
  });
}

/** How long a row that just appeared keeps .feel-flash: longer than the flash itself
 * (styles/feel.css), so a re-render during it never cuts it short. */
const FRESH_MS = 1500;

/** The keys of rows that appeared after the table first showed rows, for the moment they are new.
 * The first rows to load are not news, so they never flash; .feel-flash does nothing without the
 * feel's motion (ADR-0477). */
function useFreshRows(keys: string[]): Set<string> {
  const seen = useRef<Map<string, number> | null>(null);
  const now = Date.now();
  if (seen.current === null) {
    if (keys.length) seen.current = new Map(keys.map((key) => [key, 0]));
    return new Set();
  }
  for (const key of keys) if (!seen.current.has(key)) seen.current.set(key, now);
  const fresh = new Set(keys.filter((key) => now - (seen.current!.get(key) ?? 0) < FRESH_MS));
  return fresh;
}
