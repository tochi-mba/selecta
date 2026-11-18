import { EncodedFlac, encodeFlac, FlacBits, FlacCancelled } from './flac';
import { FlacDetails, validateFlac } from './flacDecode';
import { renderMix, RenderFailure, RenderOptions } from './render';
import { EncodedWav, encodeWavSliced, validateWav, WavBits, WavCancelled, WavDetails } from './wav';

/** The whole local export, render to checked file (ADR-0457, BF-0457-06).
 *
 * Render (with the offline limiter), encode, then re-read the finished bytes and check them
 * against the rendered duration. Only a file that passed every step is handed back; the
 * download itself stays an explicit member action in the interface. Any failure, or a cancel
 * seen at any point, comes back typed and carries no bytes.
 *
 * WAV is checked by its header and sizes. FLAC (flac.ts) is checked harder, because a decoder
 * has to understand it: validateFlac decodes every frame, checks every CRC and compares the MD5
 * of the decoded audio with the MD5 the encoder stored. Every step yields to the page in short
 * slices so a long mix does not freeze it: the render's limiter pass (render.ts), the WAV
 * writer and its sha256 (wav.ts encodeWavSliced), and the FLAC encoder and checker. A cancel
 * at any yield drops everything.
 *
 * The engine is flag-agnostic; the caller offers export only behind `cloud.local_export`.
 * `localExportFormats` is the one place that turns that flag into the formats on offer.
 */

export type ExportFormat = 'wav' | 'flac';

export type ExportSuccess = { ok: true; wav: EncodedWav; checked: WavDetails; limiter: string };
export type FlacExportSuccess = { ok: true; flac: EncodedFlac; checked: FlacDetails; limiter: string };
export type ExportResult = ExportSuccess | RenderFailure;
export type FlacExportResult = FlacExportSuccess | RenderFailure;

/** One finished, checked file, whatever its format: what a download action needs. */
export type ExportedFile = {
  format: ExportFormat;
  bytes: Uint8Array;
  sha256: string;
  durationSeconds: number;
  mimeType: string;
  extension: string;
  limiter: string;
};
export type ExportFileResult = { ok: true; file: ExportedFile } | RenderFailure;

type SliceOptions = { onEncodeProgress?: (fraction: number) => void };

const cancelled = (): RenderFailure => ({ ok: false, reason: 'cancelled', detail: 'The export was cancelled, so no file was made.' });

/** The formats a member may pick: none unless `cloud.local_export` is on. */
export function localExportFormats(flags: { localExport: boolean }): ExportFormat[] {
  return flags.localExport ? ['wav', 'flac'] : [];
}

export async function exportWav(options: RenderOptions & SliceOptions & { bits?: WavBits }): Promise<ExportResult> {
  const rendered = await renderMix(options);
  if (!rendered.ok) return rendered;
  if (options.signal?.aborted) return cancelled();
  let wav: EncodedWav;
  try {
    wav = await encodeWavSliced(rendered.chunks, options.bits ?? 16, { signal: options.signal, yieldToLoop: options.yieldToLoop });
  } catch (error) {
    if (error instanceof WavCancelled || options.signal?.aborted) return cancelled();
    return { ok: false, reason: 'invalid_output', detail: `The file could not be written: ${(error as Error | null)?.message || 'unknown reason'}.` };
  }
  const checked = validateWav(wav.bytes, { durationSeconds: rendered.durationSeconds, toleranceSeconds: 1 / rendered.sampleRate });
  if (!checked.ok) return { ok: false, reason: 'invalid_output', detail: `The finished file failed its check: ${checked.reason}` };
  if (options.signal?.aborted) return cancelled();
  return { ok: true, wav, checked, limiter: rendered.limiter };
}

export async function exportFlac(options: RenderOptions & SliceOptions & { bits?: FlacBits }): Promise<FlacExportResult> {
  const rendered = await renderMix(options);
  if (!rendered.ok) return rendered;
  if (options.signal?.aborted) return cancelled();
  let flac: EncodedFlac;
  try {
    flac = await encodeFlac(rendered.chunks, options.bits ?? 16, {
      signal: options.signal,
      onProgress: options.onEncodeProgress,
      yieldToLoop: options.yieldToLoop,
    });
  } catch (error) {
    if (error instanceof FlacCancelled || options.signal?.aborted) return cancelled();
    return { ok: false, reason: 'invalid_output', detail: `The file could not be written: ${(error as Error | null)?.message || 'unknown reason'}.` };
  }
  const checked = await validateFlac(
    flac.bytes,
    { durationSeconds: rendered.durationSeconds, toleranceSeconds: 1 / rendered.sampleRate },
    { signal: options.signal, yieldToLoop: options.yieldToLoop },
  );
  if (options.signal?.aborted) return cancelled();
  if (!checked.ok) return { ok: false, reason: 'invalid_output', detail: `The finished file failed its check: ${checked.reason}` };
  if (checked.md5 !== flac.md5) return { ok: false, reason: 'invalid_output', detail: 'The finished file failed its check: its MD5 changed after encoding.' };
  return { ok: true, flac, checked, limiter: rendered.limiter };
}

/** Export in the member's chosen format and hand back one checked file. */
export async function exportFile(options: RenderOptions & SliceOptions & { format: ExportFormat; bits?: 16 | 24 }): Promise<ExportFileResult> {
  if (options.format === 'flac') {
    const result = await exportFlac(options);
    if (!result.ok) return result;
    const { flac, checked, limiter } = result;
    return {
      ok: true,
      file: { format: 'flac', bytes: flac.bytes, sha256: flac.sha256, durationSeconds: checked.durationSeconds, mimeType: 'audio/flac', extension: 'flac', limiter },
    };
  }
  const result = await exportWav(options);
  if (!result.ok) return result;
  const { wav, checked, limiter } = result;
  return {
    ok: true,
    file: { format: 'wav', bytes: wav.bytes, sha256: wav.sha256, durationSeconds: checked.durationSeconds, mimeType: 'audio/wav', extension: 'wav', limiter },
  };
}
