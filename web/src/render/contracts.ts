/**
 * BR64-05: portable rendering contract. Audio bytes/handles never enter Cloud APIs.
 * All times are integer PCM frames on the output timebase, not floating point seconds.
 */
export type RenderStatus =
  | 'preparing' | 'rendering' | 'paused' | 'interrupted' | 'storage_pressure'
  | 'model_unsupported' | 'codec_unsupported' | 'cancelled' | 'completed';

export interface RenderSource {
  readonly recordingId: string;
  readonly sourceRevision: string;
  readonly durationFrames: number;
  /** Read exact frames, already resampled to outputRate. Must return fresh planar buffers. */
  read(startFrame: number, frames: number, outputRate: number, signal: AbortSignal): Promise<readonly Float32Array[]>;
}

export interface RenderClip {
  readonly occurrenceId: string;
  readonly recordingId: string;
  readonly sourceRevision: string;
  readonly startFrame: number;
  readonly sourceStartFrame: number;
  readonly durationFrames: number;
  readonly gain?: number;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
}

export interface PortableRenderRecipe {
  readonly recipeId: string;
  readonly revisionId: string;
  readonly schemaVersion: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly totalFrames: number;
  readonly clips: readonly RenderClip[];
}

export interface RenderProcessor {
  readonly id: string;
  readonly version: string;
  readonly modelHash?: string;
  readonly settingsHash: string;
  /** Processor must return exactly frames[channel] values. Stateful effects need their
   * own deterministic seek/overlap adapter, not a chunk-local reset. */
  process(channels: Float32Array[], startFrame: number, signal: AbortSignal): Promise<Float32Array[]>;
}

export interface RenderInput {
  recipe: PortableRenderRecipe;
  sources: ReadonlyMap<string, RenderSource>;
  processors?: readonly RenderProcessor[];
  chunkFrames?: number;
  signal: AbortSignal;
}

export interface RenderChunk {
  readonly startFrame: number;
  readonly frames: number;
  readonly channels: readonly Float32Array[];
}

export interface RenderProgress {
  readonly state: RenderStatus;
  readonly framesDone: number;
  readonly totalFrames: number;
  readonly bytesWritten: number;
  readonly message?: string;
}

export class RenderFailure extends Error {
  constructor(readonly state: RenderStatus, message: string) { super(message); this.name = 'RenderFailure'; }
}

function finiteInt(value: number, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}: ${value}`);
}

export function validateRecipe(recipe: PortableRenderRecipe, sources: ReadonlyMap<string, RenderSource>): void {
  if (!recipe.recipeId || !recipe.revisionId || recipe.schemaVersion < 1) throw new Error('Missing recipe identity');
  finiteInt(recipe.sampleRate, 'sample rate', 8000);
  if (recipe.sampleRate > 192000 || (recipe.channels !== 1 && recipe.channels !== 2)) throw new Error('Unsupported output format');
  finiteInt(recipe.totalFrames, 'total frames', 1);
  const seen = new Set<string>();
  for (const clip of recipe.clips) {
    if (!clip.occurrenceId || seen.has(clip.occurrenceId)) throw new Error('Duplicate or empty occurrence identity');
    seen.add(clip.occurrenceId);
    finiteInt(clip.startFrame, 'clip start');
    finiteInt(clip.sourceStartFrame, 'source start');
    finiteInt(clip.durationFrames, 'clip duration', 1);
    if (clip.startFrame + clip.durationFrames > recipe.totalFrames) throw new Error('Clip exceeds mix duration');
    const src = sources.get(clip.recordingId);
    if (!src || src.recordingId !== clip.recordingId || src.sourceRevision !== clip.sourceRevision) {
      throw new RenderFailure('interrupted', `Local recording ${clip.occurrenceId} missing or revision changed`);
    }
    if (clip.sourceStartFrame + clip.durationFrames > src.durationFrames) throw new Error('Clip exceeds source duration');
    if (!Number.isFinite(clip.gain ?? 1) || (clip.gain ?? 1) < 0 || (clip.gain ?? 1) > 8) throw new Error('Invalid gain');
    for (const [key, value] of [['fadeInFrames', clip.fadeInFrames ?? 0], ['fadeOutFrames', clip.fadeOutFrames ?? 0]] as const) {
      finiteInt(value, key);
      if (value > clip.durationFrames) throw new Error(`${key} exceeds duration`);
    }
  }
}

/** Canonical stable metadata digest; no filenames, source handles or PCM are hashed remotely. */
export async function artifactIdentity(recipe: PortableRenderRecipe, processors: readonly RenderProcessor[], codec: string, engineVersion = 'br64-05.1'): Promise<string> {
  const canonical = JSON.stringify({
    recipeId: recipe.recipeId, revisionId: recipe.revisionId, schemaVersion: recipe.schemaVersion,
    sampleRate: recipe.sampleRate, channels: recipe.channels, totalFrames: recipe.totalFrames,
    clips: recipe.clips.map(c => [c.occurrenceId, c.recordingId, c.sourceRevision, c.startFrame, c.sourceStartFrame, c.durationFrames, c.gain ?? 1, c.fadeInFrames ?? 0, c.fadeOutFrames ?? 0]),
    processors: processors.map(p => [p.id, p.version, p.modelHash ?? '', p.settingsHash]),
    codec, engineVersion,
  });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
