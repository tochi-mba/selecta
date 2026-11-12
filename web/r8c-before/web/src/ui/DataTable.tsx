import { ReactNode } from 'react';

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
export function DataTable<T>({ caption, columns, rows, rowKey, empty = 'Nothing to show.', onPick, pickLabel }: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  onPick?: (row: T) => void;
  pickLabel?: (row: T) => string;
}) {
  return (
    // Focusable and named, so a keyboard user can scroll a wide table sideways on a phone.
    <div className="data-table-wrap" role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={column.numeric ? 'numeric' : undefined}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="data-table-empty">{empty}</td></tr>}
          {rows.map((row) => (
            <tr key={rowKey(row)}>
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
