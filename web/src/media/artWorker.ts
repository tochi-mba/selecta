/** Module worker that turns a song file's own picture into the two cover sizes and a palette hue
 * (ADR-0478, FL-0478-01, flag `library.art_embedded`).
 *
 * Spawned by `art.ts` with the Vite module-worker convention. The picture's bytes arrive
 * transferred; two square, cover-fit images (about 96 and 512 pixels, WebP where the browser can
 * write it, else JPEG) and the dominant hue go back. Nothing here touches the network: the
 * person's pictures never leave the device.
 *
 * `makeArt` and `dominantHue` are exported pure functions, so the page can run the same code at
 * idle time where workers are unavailable, and tests can call them without a Worker runtime.
 * This module imports nothing, so the worker bundle stays small.
 */

export const ART_EDGES = { small: 96, large: 512 } as const;
export type ArtSize = keyof typeof ART_EDGES;

/** What one picture becomes. `hue` is 0 to 359, or null for a picture with no clear colour. */
export type MadeArt = { small: Blob; large: Blob; hue: number | null };

export type ArtRequest = { id: number; mime: string; bytes: ArrayBuffer };
export type ArtResponse = { id: number; art?: MadeArt; error?: string };

/** A decoded picture past this many pixels is refused rather than drawn (a decompression bomb). */
const MAX_PIXELS = 40_000_000;
/** The edge of the tiny copy the hue is read from. */
const HUE_EDGE = 24;
/** Too few coloured pixels to call a hue: a greyscale or near-black cover has none. */
const MIN_COLOURED_SHARE = 0.04;

type Canvas2D = OffscreenCanvasRenderingContext2D;

/** True where this context can decode and redraw a picture without the page. */
export function artSupported(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
}

/** The centred square of the picture drawn at `edge` pixels (never enlarged), or null. */
function square(bitmap: ImageBitmap, edge: number): { canvas: OffscreenCanvas; context: Canvas2D } | null {
  const side = Math.min(bitmap.width, bitmap.height);
  if (side < 1) return null;
  const out = Math.max(1, Math.min(edge, side));
  const canvas = new OffscreenCanvas(out, out);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  return { canvas, context };
}

async function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob | null> {
  const drawn = square(bitmap, edge);
  if (!drawn) return null;
  const webp = await drawn.canvas.convertToBlob({ type: 'image/webp', quality });
  // a browser that cannot write WebP hands back PNG instead; JPEG is far smaller for a cover
  if (webp.type === 'image/webp') return webp;
  return drawn.canvas.convertToBlob({ type: 'image/jpeg', quality });
}

/** The dominant hue of RGBA pixels: near-grey, near-black and near-white pixels are ignored, the
 * rest vote into 10-degree bins weighted by how colourful they are, and the winning bin's own
 * pixels give the exact hue. Null when too few pixels have any colour. */
export function dominantHue(pixels: Uint8ClampedArray | Uint8Array): number | null {
  const bins = new Float64Array(36);
  const sinSum = new Float64Array(36);
  const cosSum = new Float64Array(36);
  let coloured = 0;
  const total = Math.floor(pixels.length / 4);
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if (pixels[at + 3] < 128) continue;
    const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (max < 40 || chroma < 24 || chroma / max < 0.2 || (min > 225 && chroma < 40)) continue;
    let hue: number;
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue *= 60;
    const weight = (chroma / 255) * (max / 255);
    const bin = Math.min(35, Math.floor(hue / 10));
    const radians = (hue * Math.PI) / 180;
    bins[bin] += weight;
    sinSum[bin] += Math.sin(radians) * weight;
    cosSum[bin] += Math.cos(radians) * weight;
    coloured += 1;
  }
  if (!total || coloured / total < MIN_COLOURED_SHARE) return null;
  let best = 0;
  for (let bin = 1; bin < 36; bin += 1) if (bins[bin] > bins[best]) best = bin;
  if (bins[best] <= 0) return null;
  const degrees = (Math.atan2(sinSum[best], cosSum[best]) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

function hueOf(bitmap: ImageBitmap): number | null {
  const drawn = square(bitmap, HUE_EDGE);
  if (!drawn) return null;
  const { width, height } = drawn.canvas;
  return dominantHue(drawn.context.getImageData(0, 0, width, height).data);
}

/** One picture, decoded once, made into both sizes and its hue. Null when it cannot be read. */
export async function makeArt(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<MadeArt | null> {
  if (!artSupported()) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    if (bitmap.width * bitmap.height > MAX_PIXELS) return null;
    const small = await encode(bitmap, ART_EDGES.small, 0.8);
    const large = await encode(bitmap, ART_EDGES.large, 0.82);
    if (!small || !large) return null;
    return { small, large, hue: hueOf(bitmap) };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<ArtRequest>) => void) | null;
  postMessage: (message: ArtResponse) => void;
};

const scope = globalThis as unknown as Partial<WorkerScope> & { window?: unknown };

// Only wire the message loop when actually running as a worker; importing this module from the
// page (or from tests) stays side-effect free.
if (typeof scope.postMessage === 'function' && scope.window === undefined) {
  (scope as WorkerScope).onmessage = (event) => {
    // a dedicated worker only hears the page that spawned it, whose messages carry no origin
    if (event.origin !== '') return;
    const request: unknown = event.data;
    if (typeof request !== 'object' || request === null) return;
    const { id, mime, bytes } = request as Partial<ArtRequest>;
    if (typeof id !== 'number' || typeof mime !== 'string' || !(bytes instanceof ArrayBuffer)) return;
    void makeArt(bytes, mime).then(
      (art) => (scope as WorkerScope).postMessage(art ? { id, art } : { id, error: 'unreadable' }),
      () => (scope as WorkerScope).postMessage({ id, error: 'unreadable' }),
    );
  };
}
