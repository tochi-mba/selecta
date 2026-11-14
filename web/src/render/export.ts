import { artifactIdentity, type PortableRenderRecipe, type RenderProcessor, type RenderProgress, type RenderSource, RenderFailure } from './contracts';
import { renderChunks } from './chunks';
import { WavWriter, validateWav, wavExpectedBytes } from '../export-codecs/wav';
import { FlacWriter, validateFlac } from '../export-codecs/flac';
import { ArtifactStage, LocalArtifactStore, storagePreflight } from '../local-artifacts/store';

export type Codec = 'wav' | 'flac';
export interface RenderRequest {
  recipe: PortableRenderRecipe;
  sources: ReadonlyMap<string, RenderSource>;
  processors?: readonly RenderProcessor[];
  codec: Codec;
  signal: AbortSignal;
  onProgress?: (event: RenderProgress) => void;
  /** Playback engine integration MUST supply this. Do not render over live audio. */
  livePlaybackActive: () => boolean;
  chunkFrames?: number;
  store?: LocalArtifactStore;
}
const active = new Set<string>();
function report(req: RenderRequest, state: RenderProgress['state'], framesDone: number, bytesWritten: number, message?: string) {
  req.onProgress?.({ state, framesDone, totalFrames: req.recipe.totalFrames, bytesWritten, message });
}
export function estimatedOutputBytes(recipe: PortableRenderRecipe, codec: Codec): number {
  const pcmBytes = wavExpectedBytes(recipe.totalFrames, recipe.channels);
  if (codec === 'wav') return pcmBytes + 44;
  // Raw verbatim FLAC worst case includes headers/subframe bytes per 4096-sample block.
  return pcmBytes + 42 + Math.ceil(recipe.totalFrames / 4096) * (32 + recipe.channels);
}

export async function renderMixLocally(req: RenderRequest) {
  const processors = req.processors ?? [];
  const identity = await artifactIdentity(req.recipe, processors, req.codec);
  if (active.has(identity)) throw new RenderFailure('preparing', 'Identical render already running');
  if (req.livePlaybackActive()) throw new RenderFailure('paused', 'Live playback has priority; stop it before exporting');
  if (req.signal.aborted) throw new RenderFailure('cancelled', 'Cancelled before preparation');
  active.add(identity);
  let stage: ArtifactStage | undefined;
  try {
    report(req, 'preparing', 0, 0, 'Checking local space and recording access');
    await storagePreflight(estimatedOutputBytes(req.recipe, req.codec));
    const store = req.store ?? new LocalArtifactStore();
    const existing = await store.get(identity, req.codec);
    if (existing) {
      await (req.codec === 'wav'
        ? validateWav(existing.file, req.recipe.totalFrames, req.recipe.channels, req.recipe.sampleRate, existing.record.checksum)
        : validateFlac(existing.file, req.recipe.totalFrames, req.recipe.channels, req.recipe.sampleRate, existing.record.checksum));
      report(req, 'completed', req.recipe.totalFrames, existing.file.size);
      return existing;
    }
    stage = await ArtifactStage.open();
    const encoder = req.codec === 'wav'
      ? await WavWriter.open(stage, req.recipe.totalFrames, req.recipe.channels, req.recipe.sampleRate)
      : await FlacWriter.open(stage, req.recipe.totalFrames, req.recipe.channels, req.recipe.sampleRate);
    let processed = 0;
    report(req, 'rendering', 0, 0);
    for await (const chunk of renderChunks({
      recipe: req.recipe, sources: req.sources, processors,
      chunkFrames: req.chunkFrames, signal: req.signal,
    })) {
      if (req.livePlaybackActive()) throw new RenderFailure('paused', 'Render stopped to protect live playback');
      await encoder.push(chunk.channels);
      processed += chunk.frames;
      report(req, 'rendering', processed, Math.ceil(processed * req.recipe.channels * 2));
    }
    const finalized = await encoder.finish();
    const result = await store.publish(stage, identity, req.codec, {
      bytes: finalized.expectedBytes, checksum: finalized.crc32, frames: finalized.frames,
      sampleRate: req.recipe.sampleRate, channels: req.recipe.channels,
    }, file => req.codec === 'wav'
      ? validateWav(file, req.recipe.totalFrames, req.recipe.channels, req.recipe.sampleRate, finalized.crc32)
      : validateFlac(file, req.recipe.totalFrames, req.recipe.channels, req.recipe.sampleRate, finalized.crc32),
    req.signal);
    report(req, 'completed', finalized.frames, finalized.expectedBytes, 'Validated on this device');
    return result;
  } catch (error) {
    const state = error instanceof RenderFailure ? error.state : (error instanceof DOMException && error.name === 'QuotaExceededError' ? 'storage_pressure' : 'interrupted');
    report(req, state, 0, 0, String(error));
    throw error;
  } finally {
    await stage?.dispose();
    active.delete(identity);
  }
}
