/** The stems UI's view of the browser stem splitter (ADR-0459 Tier 3). The engine in dsp/stems/
 * owns the work; these types are the contract the UI renders from, so every surface here is
 * presentational and the integrator only adapts the engine's store to `StemsStore`. */

/** Why a device cannot split songs into stems. `reason` is the plain words a member reads. */
export type UnsupportedCode = 'no_webgpu_wasm_slow' | 'crash_guard' | 'budget_floor' | 'licence' | 'other';

/** Why a download did not finish. */
export type DownloadFailure = 'network' | 'checksum' | 'storage_full' | 'other';

/** Why splitting stopped for now without anyone asking it to. */
export type PauseReason = 'hidden' | 'battery' | 'thermal';

/** The splitter on this device: the model file, and whether it can work right now. */
export type SplitterState =
  | { state: 'unsupported'; reason: string; code?: UnsupportedCode }
  /** Not downloaded. `bytes` is the download size, `needBytes` the storage it needs once unpacked.
   * `updated` says an older splitter was here and a new version replaced it. `removed` says the
   * member just removed it, and `freedBytes` how much that gave back. */
  | { state: 'absent'; bytes: number; needBytes: number; updated?: boolean; removed?: boolean; freedBytes?: number }
  | { state: 'downloading'; received: number; total: number; paused: boolean; updated?: boolean }
  /** `updated` says this is a new splitter version, so stems made by the old one are made again. */
  | { state: 'ready'; bytes: number; implementation: string; updated?: boolean }
  | { state: 'failed'; why: DownloadFailure; detail?: string }
  | { state: 'paused'; why: PauseReason };

/** One transition's stem window: the stretch of both songs a stem move needs split. */
export type WindowStatus =
  | { state: 'queued' }
  | { state: 'running'; progress: number }
  | { state: 'ready' }
  | { state: 'failed'; why: string }
  | { state: 'skipped'; why: string };

/** Which device in a remote-control session this is. Only the speaker splits songs. */
export type StemsRole = 'speaker' | 'controller';

/** Everything the stems surfaces read, in one snapshot. */
export type StemsSnapshot = {
  splitter: SplitterState;
  /** Window status by transition, keyed with views/liveTransitions.ts `playedKey(from, into)`. */
  windows: Readonly<Record<string, WindowStatus>>;
  /** true on a metered or data-saver connection, null when the browser does not say. */
  metered: boolean | null;
  role: StemsRole;
};

/** What a member can ask the splitter to do. Each may return a promise; the UI shows it working. */
export type StemsActions = {
  download(): unknown;
  pause(): unknown;
  resume(): unknown;
  cancel(): unknown;
  remove(): unknown;
  /** After the crash guard tripped: let this device try splitting once more. */
  retryAfterCrash(): unknown;
};

/** An observable store the engine (or a test) provides. `get` must return the same object until
 * something changes, as React's useSyncExternalStore requires. */
export type StemsStore = {
  get(): StemsSnapshot;
  subscribe(listener: () => void): () => void;
  actions: StemsActions;
};

/** The stem moves a browser mix can ask for, named as local mode names them. */
export type StemMove = 'vocal_ride' | 'stem_arrange' | 'stem_intertwine';

/** Make a Mix's stem preference, as local mode's `steering.stems`. */

/** Why the scheduler played a non-stem move where a stem move was asked for or picked. */
export type StemDegradeCode = 'not_ready' | 'not_connected' | 'split_failed';

/** Why a stem move's recipe refused this pair (web/src/dsp/stemMoves.ts). */
export type StemRefusalCode = 'tempo' | 'grid' | 'room' | 'voice';

/** What the editor's Move picker needs to know about stems on this device. `null` means the
 * stems flag is off: the picker lists no stem moves at all. */
export type StemsAbility =
  | null
  | { state: 'ready' }
  | { state: 'download_needed' }
  | { state: 'unavailable'; reason: string };

/** The editor ability for a splitter state, with the flag already checked by the caller. A
 * controller never splits, so it reads as unavailable for the stem moves it would ask for. */
/** The stem model isn't cleared for anyone yet: stems are absent, not explained (ADR-0459). */
export const isLicenceHold = (splitter: SplitterState | null | undefined): boolean =>
  splitter?.state === 'unsupported' && splitter.code === 'licence';

export function stemsAbility(splitter: SplitterState | null | undefined, role: StemsRole = 'speaker'): StemsAbility {
  if (!splitter || isLicenceHold(splitter)) return null;
  if (role === 'controller') return { state: 'unavailable', reason: 'the device playing the music prepares stems' };
  switch (splitter.state) {
    case 'unsupported': return { state: 'unavailable', reason: splitter.reason };
    case 'ready': return { state: 'ready' };
    case 'paused': return { state: 'ready' };
    default: return { state: 'download_needed' };
  }
}
