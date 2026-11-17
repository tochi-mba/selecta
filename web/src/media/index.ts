// Browser local media (ADR-0458): import, identity, cache, re-authorisation, repair.
// Everything here is behind the `cloud.local_media` flag; the UI gates on it and reflows
// without a trace when it is off.

export const LOCAL_MEDIA_FLAG = 'cloud.local_media';

export { directoryInput, dirPicker, fileInput, opfs, storageSpace } from './capabilities';
export type { Capability, StorageSpace } from './capabilities';
export { assertNoPath, fileSha256, HASH_CHUNK_BYTES, normalise } from './identity';
export type { TrackIdentity } from './identity';
export { AUDIO_EXTENSIONS, BATCH_SIZE, defaultTagReader, isAudioName, runImport } from './importer';
export type { ImportEvent, ImportOptions, ImportSource, ImportSummary, RegisteredSong, Request, SongRegistration, TagReader } from './importer';
export { cachedBytesKey, cacheEvict, cacheRead, cacheWrite, isQuotaError, MediaStore, StorageFullError } from './store';
export type { CacheWriteResult, DirectoryHandleLike, FileHandleLike, FileRef, StoredSong } from './store';
export { acceptRepick, findLapsed } from './reauth';
export type { LapsedItem, LapsedWhy, RegrantOutcome } from './reauth';
export { makeResolver, resolveByIndex } from './resolve';
export type { MediaResolver, ResolvedTrack } from './resolve';
export { acceptReimport, anyPlayable, planRepair } from './repair';
export type { MissingReason, RepairMatch, RepairMissing, RepairPlan } from './repair';
