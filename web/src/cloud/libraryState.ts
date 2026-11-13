import type { Asset } from './api';

// The Cloud Library's loading, failure and readiness contract (ADR-0421, AV-0421-01), written
// out in docs/engineering/cloud-library-states.md.
//
// The first Library kept only "loading" and a list, so a first read that failed looked exactly
// like an empty library ("Your library is empty") with an error above it. Here the list is only
// ever shown as empty after the server has said so, a failure before any answer is its own state
// with a way to try again, and a failure after a good answer keeps the songs on screen, marked as
// possibly out of date. Off (`cloud.library_states`), Library.tsx keeps its old behaviour.

export const LIBRARY_STATES_FLAG = 'cloud.library_states';

export type LibraryData = {
  /** Songs in the order the server listed them. */
  assets: Asset[];
  /** Another page waits behind this cursor. */
  nextCursor: string | null;
};

export type LibraryState =
  /** Nothing known yet: the first read is under way. */
  | { status: 'loading' }
  /** The first read failed: nothing is known, so nothing (not even "empty") is claimed. */
  | { status: 'failed'; message: string; retrying: boolean }
  /** The server answered with no songs. */
  | { status: 'empty'; refreshing: boolean }
  /** The server answered with songs. `stale` is set when a later read failed. */
  | ({ status: 'ready'; refreshing: boolean; stale: string | null } & LibraryData);

export type LibraryEvent =
  | { type: 'request' }
  | { type: 'loaded'; assets: Asset[]; nextCursor: string | null; append: boolean }
  | { type: 'failed'; message: string }
  | { type: 'removed'; id: string };

export const INITIAL_LIBRARY: LibraryState = { status: 'loading' };

export function libraryReducer(state: LibraryState, event: LibraryEvent): LibraryState {
  switch (event.type) {
    case 'request':
      if (state.status === 'failed') return { ...state, retrying: true };
      if (state.status === 'loading') return state;
      return { ...state, refreshing: true };
    case 'loaded': {
      const assets = event.append && state.status === 'ready' ? [...state.assets, ...event.assets] : event.assets;
      if (assets.length === 0) return { status: 'empty', refreshing: false };
      return { status: 'ready', assets, nextCursor: event.nextCursor, refreshing: false, stale: null };
    }
    case 'failed':
      if (state.status === 'ready') return { ...state, refreshing: false, stale: event.message };
      // An empty library that can't be read again is no longer known to be empty.
      return { status: 'failed', message: event.message, retrying: false };
    case 'removed': {
      if (state.status !== 'ready') return state;
      const assets = state.assets.filter((asset) => asset.id !== event.id);
      return assets.length || state.nextCursor ? { ...state, assets } : { status: 'empty', refreshing: false };
    }
  }
}

/** The songs on screen in a state (none unless the server listed some). */
export function shownAssets(state: LibraryState): Asset[] {
  return state.status === 'ready' ? state.assets : [];
}

export function isBusy(state: LibraryState) {
  return state.status === 'loading' || (state.status === 'failed' && state.retrying) || ('refreshing' in state && state.refreshing);
}

/** The overview's numbers (AV-0421-04): songs listed so far, whether more exist, and uploads
 * still on their way in. `null` counts mean "not known", never zero. */
export type LibraryOverview = { songs: number | null; more: boolean; processing: number | null };

export function overviewOf(state: LibraryState, processing: number | null): LibraryOverview {
  if (state.status === 'ready') return { songs: state.assets.length, more: Boolean(state.nextCursor), processing };
  if (state.status === 'empty') return { songs: 0, more: false, processing };
  return { songs: null, more: false, processing };
}

export function songWords(overview: LibraryOverview) {
  if (overview.songs === null) return 'Not loaded yet';
  const count = `${overview.songs}${overview.more ? '+' : ''}`;
  return `${count} ${overview.songs === 1 && !overview.more ? 'song' : 'songs'}`;
}

// ---------------------------------------------------------------------------------------------
// Per-file upload outcomes (AV-0421-03). The first Uploads page ended every batch with one
// "Upload finished" message, even when some files were refused or failed. Each chosen file now
// ends with exactly one outcome, and the summary counts them.

export type UploadOutcome = 'added' | 'already' | 'skipped' | 'failed' | 'not-started';

export type UploadResult = { name: string; status: string; detail?: string; outcome?: UploadOutcome };

/** The outcome a finished `/complete` answer means. */
export function completeOutcome(status: string): UploadOutcome {
  if (status === 'accepted') return 'added';
  return 'failed';
}

/** Words for a `/complete` status that isn't plain acceptance. */
export function completeStatusWords(status: string) {
  if (status === 'accepted') return 'Upload accepted';
  if (status === 'rejected') return 'Not accepted';
  return 'Needs attention';
}

/** Mark the chosen files that never got an outcome because the batch stopped early. */
export function withUnreached(results: UploadResult[], chosen: string[], reason: string): UploadResult[] {
  const reached = new Map<string, number>();
  for (const result of results) reached.set(result.name, (reached.get(result.name) ?? 0) + 1);
  const missing: UploadResult[] = [];
  for (const name of chosen) {
    const left = reached.get(name) ?? 0;
    if (left > 0) reached.set(name, left - 1);
    else missing.push({ name, status: 'Not uploaded', detail: reason, outcome: 'not-started' });
  }
  return [...results, ...missing];
}

/** One sentence for a whole batch, counting each kind of outcome. */
export function uploadSummary(results: UploadResult[]): { text: string; problem: boolean } {
  const count = (kind: UploadOutcome) => results.filter((result) => result.outcome === kind).length;
  const total = results.length;
  const added = count('added');
  const already = count('already');
  const skipped = count('skipped');
  const failed = count('failed') + count('not-started');
  const files = (value: number) => `${value} ${value === 1 ? 'file' : 'files'}`;
  if (total === 0) return { text: 'Nothing was uploaded.', problem: false };
  if (added === total) return { text: `${total === 1 ? 'Your file was' : `All ${files(total)} were`} added to your library.`, problem: false };
  const parts = [`${added} of ${files(total)} added to your library`];
  if (already) parts.push(`${already} already there`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} need${failed === 1 ? 's' : ''} attention`);
  const tail = failed ? ' Choose a file that needs attention again to carry on from where it stopped.' : '';
  return { text: `${parts.join(', ')}.${tail}`, problem: failed > 0 };
}
