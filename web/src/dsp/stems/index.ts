/** The in-browser stem splitter (ADR-0459 Tier 3), shipped dark: `stem_separation` stays
 * unsupported_here until a licence record and device evidence exist (dsp/capability.ts). */

export * from './cache';
export * from './gate';
export * from './model';
export * from './observable';
export * from './prefetch';
export * from './windows';
export { hasWebGpu, loadStemRuntime, type StemBackend, type StemRuntime } from './runtime';
export {
  separateInWorker,
  spawnStemsWorker,
  workerSeparator,
  type SeparateOptions,
  type SeparationResult,
  type StemSeparator,
} from '../workers/stemsSpawn';
