import { renderMix, RenderFailure, RenderOptions } from './render';
import { EncodedWav, encodeWav, validateWav, WavBits, WavDetails } from './wav';

/** The whole local export, render to checked file (ADR-0457, BF-0457-06).
 *
 * Render (with the offline limiter), encode, then re-read the finished bytes and check them
 * against the rendered duration. Only a file that passed every step is handed back; the
 * download itself stays an explicit member action in the interface. Any failure, or a cancel
 * seen at any point, comes back typed and carries no bytes.
 */

export type ExportSuccess = { ok: true; wav: EncodedWav; checked: WavDetails; limiter: string };
export type ExportResult = ExportSuccess | RenderFailure;

export async function exportWav(options: RenderOptions & { bits?: WavBits }): Promise<ExportResult> {
  const rendered = await renderMix(options);
  if (!rendered.ok) return rendered;
  if (options.signal?.aborted) return { ok: false, reason: 'cancelled', detail: 'The export was cancelled, so no file was made.' };
  let wav: EncodedWav;
  try {
    wav = encodeWav(rendered.chunks, options.bits ?? 16);
  } catch (error) {
    return { ok: false, reason: 'invalid_output', detail: `The file could not be written: ${(error as Error | null)?.message || 'unknown reason'}.` };
  }
  const checked = validateWav(wav.bytes, { durationSeconds: rendered.durationSeconds, toleranceSeconds: 1 / rendered.sampleRate });
  if (!checked.ok) return { ok: false, reason: 'invalid_output', detail: `The finished file failed its check: ${checked.reason}` };
  if (options.signal?.aborted) return { ok: false, reason: 'cancelled', detail: 'The export was cancelled, so no file was made.' };
  return { ok: true, wav, checked, limiter: rendered.limiter };
}
