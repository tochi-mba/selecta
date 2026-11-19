// Test only: the browser media runtime the storage-pressure spec (storage-pressure.cloud.ts)
// bundles and loads into a real page, so the shipped store.ts and importer.ts run against the
// browser's own IndexedDB and OPFS. Never part of the app build.
export { cacheEvict, cacheRead, cacheWrite, isQuotaError, MediaStore, StorageFullError } from '../src/media/store';
export { runImport } from '../src/media/importer';
