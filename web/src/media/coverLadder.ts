import { flagOn } from '../flags';
import { getArtHue, getArtImage, songKeyFor } from './artStore';
import { catalogCoverFor } from './catalogArt';
import { serverArtUrl } from './serverArt';

// The cover ladder (ADR-0478 FL-0478-05) for the places that live outside React: the lock screen
// and system media controls (audio/mediaSession.ts) and the ambient colour (feel/useMusicFeel.ts).
// The rungs and their order are views/CoverArt.tsx's: the file's own picture kept on this device,
// then the one the local app's server reads from the file, then SelectaDJ's own catalogue; nothing
// when none has a picture, so the caller keeps the generated tile's hue and no artwork.

/** A cover found on the ladder. `sha` is set for a picture kept on this device, whose `blob:` URL
 * the page's small cache may later revoke; any other address stays good. */
export type LadderCover = { src: string; type?: string; sha?: string; hue: number | null };

/** Decode a picture fully before it is trusted. A song with no picture of its own makes the local
 * server answer with no content, which never decodes, so it counts as no picture. */
function decoded(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  if (typeof image.decode !== 'function') return Promise.resolve(null);
  return image.decode().then(() => image, () => null);
}

/** The picture's main hue, 0 to 359, measured from a small copy: each pixel's hue weighted by how
 * colourful it is, so a grey border or a black background does not decide it. Null for a picture
 * with no real colour, or where the browser cannot read the pixels. */
export function measuredHue(image: CanvasImageSource): number | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let x = 0;
    let y = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = [data[index] / 255, data[index + 1] / 255, data[index + 2] / 255];
      const high = Math.max(r, g, b);
      const chroma = high - Math.min(r, g, b);
      if (chroma < 0.08) continue;
      const turn = high === r ? ((g - b) / chroma + 6) % 6 : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
      const angle = (turn * Math.PI) / 3;
      x += Math.cos(angle) * chroma;
      y += Math.sin(angle) * chroma;
    }
    if (Math.hypot(x, y) < 1) return null;
    return Math.round((((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360);
  } catch {
    return null;
  }
}

async function deviceCover(songId: number, withImage: boolean): Promise<LadderCover | null> {
  const sha = await songKeyFor(songId).catch(() => null);
  if (!sha) return null;
  if (!withImage) {
    const hue = await getArtHue(sha).catch(() => null);
    // only a picture that is really kept has a hue worth using
    return hue === null ? null : { src: '', sha, hue };
  }
  const image = await getArtImage(sha, 'large').catch(() => null);
  if (!image) return null;
  return { src: image.src, type: image.type, sha, hue: await getArtHue(sha).catch(() => null) };
}

async function servedCover(songId: number): Promise<LadderCover | null> {
  const src = serverArtUrl(songId);
  if (!src) return null;
  const image = await decoded(src);
  return image ? { src, hue: measuredHue(image) } : null;
}

/** The song's cover from the first rung that has one, or null. */
export async function coverForSong(songId: number): Promise<LadderCover | null> {
  if (!Number.isInteger(songId) || songId < 1) return null;
  if (flagOn('library.art_embedded')) {
    const own = (await deviceCover(songId, true)) ?? (await servedCover(songId));
    if (own) return own;
  }
  if (flagOn('library.art_lookup')) {
    const catalog = await catalogCoverFor(songId);
    if (catalog) return { src: catalog.url, hue: catalog.hue };
  }
  return null;
}

/** Just the cover's hue, for the ambient colour: the same ladder, without making a picture's URL
 * where only its hue is needed. Null when no rung has a picture or the picture has no colour. */
export async function coverHueForSong(songId: number): Promise<number | null> {
  if (!Number.isInteger(songId) || songId < 1) return null;
  if (flagOn('library.art_embedded')) {
    const kept = await deviceCover(songId, false);
    if (kept) return kept.hue;
    const served = await servedCover(songId);
    if (served) return served.hue;
  }
  if (flagOn('library.art_lookup')) return (await catalogCoverFor(songId))?.hue ?? null;
  return null;
}
