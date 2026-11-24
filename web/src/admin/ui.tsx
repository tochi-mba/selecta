import { ReactNode, useEffect, useId, useState } from 'react';
import { useMediaQuery } from '../ui/useMediaQuery';
import { since, when } from './adminApi';
import { setQuery } from './route';

/** A small quiet status badge. `tone` carries meaning only: ok, warn, bad or neutral. */
export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral'; title?: string }) {
  return <span className={`admin-badge ${tone}`} title={title}>{children}</span>;
}

/** Capitalised words for a raw value: "premium" becomes "Premium", "past_due" "Past due". */
export function words(value: string | null | undefined) {
  if (!value) return '';
  const text = value.replace(/[_.]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A time, relative in words, with the exact local time on hover and focus. */
export function Time({ at }: { at: number | null | undefined }) {
  if (!at) return <span className="admin-soft">never</span>;
  return <time dateTime={new Date(at * 1000).toISOString()} title={when(at)} tabIndex={0}>{since(at)}</time>;
}

/** An id with a copy button; never an unlabelled id. */
export function CopyId({ id, label = 'id' }: { id: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="admin-soft">none</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(id); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* the id is still visible to select */ }
  };
  return (
    <span className="admin-id">
      <code title={id}>{id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id}</code>
      <button type="button" className="admin-icon-button" aria-label={`Copy ${label} ${id}`} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  );
}

/** "What's this?": a plain-words explanation behind a small button, readable by keyboard. */
export function WhatsThis({ children, label }: { children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="admin-whats">
      <button type="button" className="admin-icon-button" aria-expanded={open} aria-controls={id} aria-label={`What is ${label}?`} onClick={() => setOpen(!open)}>?</button>
      {open && <span id={id} role="note" className="admin-whats-text">{children}</span>}
    </span>
  );
}

/** An empty list that teaches: what will appear here, why none is good news, what to do next. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="admin-empty"><p><strong>{title}</strong></p>{children && <p className="admin-soft">{children}</p>}</div>;
}

/** A skeleton the shape of the final rows, so the page does not jump when it arrives. */
export function Skeleton({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return <div className="admin-skeleton-rows" aria-busy="true" aria-label={label}>{Array.from({ length: rows }, (_, i) => <span key={i} />)}</div>;
}

export function Problem({ error, onRetry }: { error: string; onRetry?: () => void }) {
  if (!error) return null;
  return <p className="admin-error" role="alert">{error} {onRetry && <button type="button" className="quiet" onClick={onRetry}>Try again</button>}</p>;
}

/** A section separated by one hairline, not a box. */
export function Section({ title, children, actions, tour, help }: { title: string; children: ReactNode; actions?: ReactNode; tour?: string; help?: ReactNode }) {
  return (
    <section className="admin-section" aria-label={title} data-tour={tour}>
      <div className="admin-section-head"><h2>{title}{help && <WhatsThis label={title}>{help}</WhatsThis>}</h2>{actions && <div className="admin-actions">{actions}</div>}</div>
      {children}
    </section>
  );
}

export type Col<T> = {
  key: string; label: string; render?: (row: T) => ReactNode; sort?: (row: T) => string | number;
  numeric?: boolean; help?: string; optional?: boolean;
};

/**
 * The console's one table (doc 07b §7B.3): sort by a column (kept in the URL as `sort`), choose
 * columns, open a row with its first cell's button or Enter, and cards below 600 px. Rows are
 * paged by the caller; this never loads everything.
 */
export function AdminTable<T>({ caption, rows, cols, rowKey, onOpen, openLabel, empty, sortKey = 'sort', loading }: {
  caption: string; rows: T[]; cols: Col<T>[]; rowKey: (row: T) => string; onOpen?: (row: T) => void;
  openLabel?: (row: T) => string; empty: ReactNode; sortKey?: string; loading?: boolean;
}) {
  const narrow = useMediaQuery('(max-width: 599px)');
  const params = new URLSearchParams(window.location.search);
  const [sort, setSort] = useState(params.get(sortKey) ?? '');
  const [hidden, setHidden] = useState<string[]>(() => cols.filter((c) => c.optional).map((c) => c.key));
  const [choosing, setChoosing] = useState(false);
  useEffect(() => { setQuery({ [sortKey]: sort || undefined }); }, [sort, sortKey]);
  const desc = sort.startsWith('-');
  const by = cols.find((c) => c.key === sort.replace(/^-/, ''));
  const sorted = by?.sort ? [...rows].sort((a, b) => {
    const x = by.sort!(a); const y = by.sort!(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
  }) : rows;
  const shown = cols.filter((c) => !hidden.includes(c.key));
  const cell = (row: T, col: Col<T>, index: number) => {
    const value = col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '');
    return index === 0 && onOpen ? <button type="button" className="admin-row-open" onClick={() => onOpen(row)} aria-label={openLabel?.(row)}>{value}</button> : value;
  };
  if (loading && rows.length === 0) return <Skeleton label={`Loading ${caption}`} />;
  const chooser = cols.some((c) => c.optional) && (
    <div className="admin-table-tools">
      <button type="button" className="quiet" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>Columns</button>
      {choosing && <fieldset className="admin-columns"><legend>Show columns</legend>{cols.slice(1).map((c) => (
        <label key={c.key}><input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => setHidden(hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])} />{c.label}</label>
      ))}</fieldset>}
    </div>
  );
  if (narrow) {
    return (
      <div className="admin-table" role="region" aria-label={caption}>
        {chooser}
        {sorted.length === 0 ? empty : <ul className="admin-cards">{sorted.map((row) => (
          <li key={rowKey(row)}><dl>{shown.map((col, i) => <div key={col.key}><dt>{col.label}</dt><dd>{cell(row, col, i)}</dd></div>)}</dl></li>
        ))}</ul>}
      </div>
    );
  }
  return (
    <div className="admin-table" role="region" aria-label={caption} tabIndex={0}>
      {chooser}
      <table>
        <caption className="admin-visually-hidden">{caption}</caption>
        <thead><tr>{shown.map((col) => {
          const active = by?.key === col.key;
          return (
            <th key={col.key} scope="col" className={col.numeric ? 'numeric' : undefined} aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}>
              {col.sort ? <button type="button" className="admin-sort" onClick={() => setSort(active && !desc ? `-${col.key}` : active ? '' : col.key)}>{col.label}</button> : col.label}
              {col.help && <WhatsThis label={col.label}>{col.help}</WhatsThis>}
            </th>
          );
        })}</tr></thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={shown.length}>{empty}</td></tr>}
          {sorted.map((row) => <tr key={rowKey(row)}>{shown.map((col, i) => <td key={col.key} className={col.numeric ? 'numeric' : undefined}>{cell(row, col, i)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
