/** Stable entrypoints for browser player, local render/export and optional model adapters. */
export { DSP_VERSION, MOBILE_BUDGET, DESKTOP_BUDGET, DSPUnsupported, DSPCancelled,
  assertPCM, allocatePCM, checkCancelled, mono, db } from './types';
export type { PCM, ProcessingBudget, DSPArtifact, PreparedAudio } from './types';
export { fft, hann, spectrum } from './fft';
export { resample, sincAt } from './resample';
export { samplePeak, truePeak, limitPCM, peakReport, rmsDb } from './dynamics';
export { extractSpectral, segmentSections } from '../analysis/spectral';
export type { MusicalFeatures, Section, SpectralFrame } from '../analysis/spectral';
export { fitBeatGrid, detectBeats } from '../analysis/beats';
export type { BeatGrid, BeatModelAdapter } from '../analysis/beats';
export { chromaKey, inferKey, camelot, camelotDistance } from '../analysis/key';
export type { KeyResult, LearnedKeyAdapter } from '../analysis/key';
export { stretchPCM, stretchWarp, validateWarp, warpAt } from '../time-stretch/vocoder';
export type { Warp } from '../time-stretch/vocoder';
export { renderTransitionWindow } from '../transitions/render';
export type { RenderOptions, SourceWindows } from '../transitions/render';
export { equalPowerFade, stepCurve, logarithmicSweep } from '../transitions/script';
export type { Curve, TransitionPart, TransitionScript } from '../transitions/script';
export { runDSPJob } from '../workers/client';
export type { DSPRequest, DSPResult, DSPFailure } from '../workers/protocol';

export { canBeatmatch, canIntertwine, choosePhraseCues, makeTransition } from '../transitions/recipes';
export type { MusicalCue, TrackTiming, TransitionStyle, RecipeOptions } from '../transitions/recipes';

export { integratedLoudness,loudnessGainDb } from './loudness';
export type { LoudnessReport } from './loudness';
