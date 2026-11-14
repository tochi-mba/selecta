/** Default browser-only composition for Selecta Cloud. No audio, paths, PCM or digests
 * cross an API boundary. The Cloud stores only user-approved opaque recipe metadata.
 * Heavy/unqualified transitions and alternate masters fail closed. */
import { localCatalogue } from '../../media/localCatalogue';
import { browserEngine } from '../../engine/registry';
import { probeBrowserAudio } from '../../engine/capabilities';
import { audioBufferSource } from '../../render/chunks';
import { renderMixLocally } from '../../render/export';
import type { PortableRenderRecipe, RenderClip, RenderSource } from '../../render/contracts';
import type {
  BrowserAvailability, BrowserMediaState, BrowserStudioPorts, PortableRecipe, StudioRecording,
} from './browserPorts';

const SAMPLE_RATE = 44_100;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_BYTES = 96 * 1024 * 1024;
const INVALID = new Error('The exact local recording is unavailable. Reconnect this device\'s music first.');
const stableId = (prefix: string): string => prefix + crypto.randomUUID().replaceAll('-', '');

function allowedRecipe(recipe: PortableRecipe): string | null {
  if (!recipe.occurrences.length || recipe.occurrences.length > 200) return 'Choose a recipe with 1–200 recordings.';
  if (recipe.cues.some((cue) => cue.timebase !== 'source_seconds' || !Number.isFinite(cue.at) || cue.at < 0)) {
    return 'Beat-based cues need a verified beat grid before local rendering or playback.';
  }
  if (recipe.transitions.length !== recipe.occurrences.length - 1) {
    return 'Each adjacent recording needs an explicit saved transition before playback or rendering.';
  }
  for (let index = 0; index < recipe.transitions.length; index++) {
    const transition = recipe.transitions[index];
    if (transition.from_occurrence_id !== recipe.occurrences[index].occurrence_id
      || transition.to_occurrence_id !== recipe.occurrences[index + 1].occurrence_id) {
      return 'The saved transition order does not match this mix. Save and verify the arrangement.';
    }
  }
  if (recipe.transitions.some((step) =>
    step.type !== 'cut' && step.type !== 'crossfade')) {
    return 'Beatmatched and planned seams require validated browser DSP. Choose Cut or Crossfade.';
  }
  if (recipe.transitions.some((step) => !Number.isFinite(step.duration_seconds) ||
      step.duration_seconds < 0 || step.duration_seconds > 12)) {
    return 'Crossfades longer than 12 seconds are not yet qualified in the browser runtime.';
  }
  return null;
}

export function liveBrowserStudioPorts(workspaceId: string): BrowserStudioPorts {
  const catalogue = localCatalogue(workspaceId);
  const engine = browserEngine(workspaceId);
  // This is browser-profile-local, not a Cloud device registration or remotely trusted ID.
  const deviceId = 'browser_' + workspaceId;

  function locate(row: StudioRecording) {
    if (!row.canonical_track_id || !row.recording_version) return null;
    return catalogue.recordings.find((record) =>
      record.canonicalTrackId === row.canonical_track_id &&
      record.id === row.recording_version &&
      record.readiness === 'ready' &&
      Boolean(record.identity.exactSha256)) ?? null;
  }
  async function filesFor(recipe: PortableRecipe) {
    const selected = [];
    for (const row of recipe.occurrences) {
      const record = locate(row);
      if (!record) throw INVALID;
      // openRecording checks size, lastModified and the COMPLETE local SHA-256 again.
      const file = await catalogue.openRecording(record.id);
      selected.push({ id: row.occurrence_id, title: row.title, file });
    }
    return selected;
  }

  const media: NonNullable<BrowserStudioPorts['media']> = {
    deviceId,
    async importFiles(files) {
      if (!files.length || files.length > 200) throw new Error('Import 1–200 local music files per batch.');
      const sourceId = stableId('studio_');
      await catalogue.scan(files, { origin: 'file_input', label: 'Studio selection', sourceId });
      const records = catalogue.recordings.filter((r) => r.sourceId === sourceId &&
        r.readiness === 'ready' && Boolean(r.identity.exactSha256));
      return records.map((record) => {
        const reference = record.canonicalTrackId ?? stableId('track_');
        catalogue.bindCanonical(record.id, reference);
        return {
          canonical_track_id: reference, recording_version: record.id,
          title: record.title, artist: record.artist,
        };
      });
    },
    async inspect(recipe): Promise<BrowserAvailability> {
      const started = Date.now();
      const tracks: BrowserAvailability['tracks'] = [];
      for (const row of recipe.occurrences) {
        const record = locate(row);
        let state: BrowserMediaState = 'missing_media';
        let exactIdentityVerified = false;
        let reason = 'Connect the exact local recording; titles alone cannot prove a master.';
        if (record) {
          try {
            await catalogue.openRecording(record.id);
            state = 'available';
            exactIdentityVerified = true;
            reason = 'Local full-file identity and permission checked.';
          } catch {
            state = 'permission_required';
            reason = 'Local file permission expired or its content changed.';
          }
        } else if (row.canonical_track_id && catalogue.recordings.some((candidate) =>
          candidate.canonicalTrackId === row.canonical_track_id)) {
          state = 'alternative_master';
          reason = 'This reference no longer matches the authorised local recording version.';
        }
        tracks.push({
          occurrenceId: row.occurrence_id, canonicalTrackId: row.canonical_track_id,
          recordingVersion: row.recording_version, state, exactIdentityVerified,
          reason, verifiedAt: Date.now(),
        });
      }
      const snapshot = engine.snapshot();
      return {
        recipeId: recipe.recipe_id, revisionId: recipe.revision_id, deviceId,
        verifiedAt: started, expiresAt: Date.now() + 30_000,
        outputVerified: snapshot.phase === 'playing' && snapshot.soundCheck === 'user_confirmed',
        tracks,
      };
    },
  };

  const playback: NonNullable<BrowserStudioPorts['playback']> = {
    status() {
      const state = engine.snapshot();
      return {
        deviceLabel: 'This browser',
        playing: state.phase === 'playing',
        outputVerified: state.phase === 'playing' && state.soundCheck === 'user_confirmed',
        detail: state.pending ?? state.error ??
          'Local browser speaker; physical audio requires confirmation.',
      };
    },
    async playHere(recipe) {
      const problem = allowedRecipe(recipe);
      if (problem) throw new Error(problem);
      // The live two-deck player currently starts full recordings at offset 0.
      // Rendering honours source-second cues, but live playback must not silently
      // ignore them or claim it is performing the saved arrangement.
      if (recipe.cues.some((cue) => cue.at > 0)) {
        throw new Error('Non-zero source cues require local rendering; live cue-accurate playback is not yet qualified.');
      }
      const fades = recipe.transitions.map((step) => step.type === 'cut' ? 0 : step.duration_seconds);
      if (fades.length && fades.some((fade) => fade !== fades[0])) {
        throw new Error('Per-transition fade durations are not yet supported by live playback; render the saved mix instead.');
      }
      if (!probeBrowserAudio().eligible) throw new Error('Browser audio capability or tab ownership is unavailable.');
      // Initiate AudioContext.resume from the actual click, before any asynchronous
      // source verification. This is essential to user-gesture restrictions on iPadOS.
      const activation = engine.activate();
      await activation;
      const selected = await filesFor(recipe);
      await engine.setQueue(selected);
      engine.setFade(fades[0] ?? 0);
      await engine.play();
      if (engine.snapshot().phase !== 'playing') {
        throw new Error(engine.snapshot().error ?? 'Local audio could not start.');
      }
    },
    async controlAnotherDevice() {
      window.dispatchEvent(new Event('selecta:open-remote-control'));
    },
  };

  const renderer: NonNullable<BrowserStudioPorts['renderer']> = {
    supported(recipe) {
      const reason = allowedRecipe(recipe);
      if (reason) return { supported: false, reason };
      if (typeof OfflineAudioContext === 'undefined' || !navigator.storage?.getDirectory) {
        return { supported: false, reason: 'Local decoding or the private temporary filesystem is unavailable in this browser.' };
      }
      return { supported: true };
    },
    async render(recipe, { signal }) {
      const supported = renderer.supported(recipe);
      if (!supported.supported) throw new Error(supported.reason ?? 'Local render unavailable.');
      if (engine.snapshot().phase === 'playing' || engine.snapshot().phase === 'starting') {
        throw new Error('Stop live playback before rendering; real-time sound has priority.');
      }
      const selected = await filesFor(recipe);
      const context = new OfflineAudioContext(2, 1, SAMPLE_RATE);
      const buffers: AudioBuffer[] = [];
      let allocated = 0;
      for (const source of selected) {
        if (signal.aborted) throw new DOMException('Render cancelled', 'AbortError');
        if (source.file.size > MAX_SOURCE_BYTES) throw new Error('File exceeds safe browser decoding limit. Use a shorter source.');
        const decoded = await context.decodeAudioData(await source.file.arrayBuffer());
        allocated += decoded.length * decoded.numberOfChannels * 4;
        if (!decoded.length || decoded.sampleRate !== SAMPLE_RATE || allocated > MAX_DECODED_BYTES) {
          throw new Error('Source decoding exceeded the safe PCM memory budget or output timebase.');
        }
        buffers.push(decoded);
      }
      const sources = new Map<string, RenderSource>();
      const clips: RenderClip[] = [];
      let cursor = 0;
      for (let index = 0; index < recipe.occurrences.length; index++) {
        const row = recipe.occurrences[index];
        const buffer = buffers[index];
        const cue = recipe.cues.find((item) => item.occurrence_id === row.occurrence_id);
        const sourceStartFrame = cue ? Math.round(cue.at * SAMPLE_RATE) : 0;
        const durationFrames = buffer.length - sourceStartFrame;
        if (durationFrames <= 0) throw new Error('Cue lies beyond the local recording duration.');
        const previous = clips[index - 1];
        let fade = 0;
        if (previous) {
          const step = recipe.transitions[index - 1];
          if (!step || step.from_occurrence_id !== recipe.occurrences[index - 1].occurrence_id ||
            step.to_occurrence_id !== row.occurrence_id) throw new Error('Transition order changed; save and recheck the recipe.');
          fade = step.type === 'crossfade' ? Math.round(step.duration_seconds * SAMPLE_RATE) : 0;
          fade = Math.min(fade, previous.durationFrames, durationFrames);
          cursor -= fade;
          clips[index - 1] = { ...previous, fadeOutFrames: fade };
        }
        sources.set(row.occurrence_id, audioBufferSource(row.occurrence_id, row.recording_version!, buffer));
        clips.push({
          occurrenceId: row.occurrence_id, recordingId: row.occurrence_id,
          sourceRevision: row.recording_version!, startFrame: cursor,
          sourceStartFrame, durationFrames, fadeInFrames: fade,
        });
        cursor += durationFrames;
      }
      const portable: PortableRenderRecipe = {
        recipeId: recipe.recipe_id, revisionId: recipe.revision_id,
        schemaVersion: recipe.schema_version, sampleRate: SAMPLE_RATE,
        channels: 2, totalFrames: cursor, clips,
      };
      const completed = await renderMixLocally({
        recipe: portable, sources, signal, codec: 'wav',
        livePlaybackActive: () => ['playing', 'starting'].includes(engine.snapshot().phase),
      });
      return {
        filename: 'selecta-' + recipe.recipe_id + '-' + recipe.revision_number + '.wav',
        mimeType: 'audio/wav', blob: completed.file,
      };
    },
  };

  return { media, playback, renderer };
}
