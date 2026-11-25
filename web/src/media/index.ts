// Browser local media (ADR-0458): import, identity, cache, re-authorisation, repair.
// Everything here is behind the `cloud.local_media` flag; the UI gates on it and reflows
// without a trace when it is off.

export { directoryInput, dirPicker, fileInput, opfs, storageSpace } from './capabilities';
export type { Capability, StorageSpace } from './capabilities';
export { AVAILABILITY_REPORT_BATCH, deviceAvailabilitySnapshot, refreshDeviceAvailability, reportDeviceAvailability } from './availability';
export type { DeviceAvailabilitySnapshot } from './availability';
export { assertNoPath, fileSha256, HASH_CHUNK_BYTES, normalise } from './identity';
export type { TrackIdentity } from './identity';
export { AUDIO_EXTENSIONS, BATCH_SIZE, defaultTagReader, FIRST_BATCH, isAudioName, runImport } from './importer';
export type { ImportEvent, ImportOptions, ImportSource, ImportSummary, RegisteredSong, Request, SongRegistration, TagReader, WalkedFolder } from './importer';
export { CACHE_KEY_VERSION, cacheClearAll, cachedBytesKey, cacheEvict, cacheRead, cacheSongBytes, cacheWrite, deleteDatabase, isQuotaError, MEDIA_DB_PREFIX, mediaDbName, MediaStore, readSongBytes, StorageFullError, type CacheScope } from './store';
export type { CacheWriteResult, DirectoryHandleLike, FileHandleLike, FileRef, SongSource, StoredSong } from './store';
export { forgetFolder, FOLDERS_DB, legacyFolderId, listWatchedFolders, newFolderId, recallFolder, rememberFolder, removeWatchedFolder, saveWatchedFolder } from './folders';
export type { FolderState, StoredFolderHandle, WatchedFolder } from './folders';
export { dropFolderSources, factsOf, planCheck, rebaseSources, relationOf, songsIn, songsOnlyIn, walkFolder } from './folderCheck';
export type { CheckPlan, FileFacts, FolderRelation, WalkedFile } from './folderCheck';
export { acceptRepick, findLapsed } from './reauth';
export type { LapsedItem, LapsedWhy, RegrantOutcome } from './reauth';
export { makeCoexistingResolver, makeResolver, makeSourceBook, NOT_ANYWHERE, NOT_ON_DEVICE, resolveByIndex } from './resolve';
export type { MediaResolver, MusicSource, ResolvedTrack, SourceBook, SourceEntry } from './resolve';
export { acceptReimport, anyPlayable, planRepair } from './repair';
export type { MissingReason, RepairMatch, RepairMissing, RepairPlan } from './repair';
