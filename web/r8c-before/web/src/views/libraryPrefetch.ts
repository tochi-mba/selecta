import { get, LibraryPage } from '../api';

/** The Library's page request, built one way for the page and for the early read below. */
export function libraryUrl(query: string, filter: string, sort: string, after?: string | null, limit = 100) {
  const params = new URLSearchParams({ q: query, state: filter, sort, limit: String(limit) });
  if (after) params.set('after', after);
  return `/library?${params}`;
}

// An early answer is only used if the Library asks for exactly it soon after; anything older is
// dropped, so a later visit never shows stale rows.
const FRESH_FOR_MS = 10_000;
let early: { url: string; at: number; answer: Promise<LibraryPage> } | null = null;

/** MI-0162-04: opening the app on /library asks for the first rows at once, alongside status and
 * the mix, instead of after them. `search` is the address's query string. */
export function prefetchLibrary(search: string) {
  const address = new URLSearchParams(search);
  const url = libraryUrl(address.get('q') ?? '', address.get('show') ?? 'all', address.get('sort') ?? 'title');
  const answer = get<LibraryPage>(url);
  answer.catch(() => undefined);
  early = { url, at: performance.now(), answer };
}

/** Whether an early answer for this request is waiting. */
export function hasEarlyLibrary(url: string) {
  return !!early && early.url === url && performance.now() - early.at <= FRESH_FOR_MS;
}

/** The early answer for this request, used once; null when there isn't a fresh one. */
export function takeEarlyLibrary(url: string): Promise<LibraryPage> | null {
  const waiting = hasEarlyLibrary(url) ? early!.answer : null;
  early = null;
  return waiting;
}
