import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { bindArtIndex, putArt, resetArtStoreForTests } from '../media/artStore';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { CoverArt } from './CoverArt';

/** ADR-0478 "Real or clearly generated": a cover is the file's own picture (or one from our own
 * origin passed in), else the generated tile. The tile is always drawn underneath, and a picture
 * that will not decode leaves the tile alone. */

const SHA = 'c'.repeat(64);
const NONE = 'd'.repeat(64);
const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
const imageApi = HTMLImageElement.prototype as Partial<HTMLImageElement>;

async function storeCover(hue: number | null = 40) {
  await putArt(SHA, { small: new Blob(['s'], { type: 'image/webp' }), large: new Blob(['l'], { type: 'image/webp' }), hue });
}

beforeEach(() => {
  resetArtStoreForTests();
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  let made = 0;
  urlApi.createObjectURL = vi.fn((blob: Blob) => { made += 1; return `blob:local/${made}-${blob.size}`; });
  urlApi.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetArtStoreForTests();
  delete urlApi.createObjectURL;
  delete urlApi.revokeObjectURL;
  delete imageApi.decode;
});

const tile = (container: HTMLElement) => container.querySelector<HTMLElement>('.cover-art')!;
const images = (container: HTMLElement) => [...container.querySelectorAll<HTMLImageElement>('img')];

describe('FL-0478-01 CoverArt', () => {
  it('draws the generated tile alone when the song has no picture', async () => {
    const { container } = render(<CoverArt seed="Song" songKey={NONE} />);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(tile(container)).toHaveAttribute('aria-hidden', 'true');
    expect(tile(container)).not.toHaveAttribute('data-art');
    expect(images(container)).toHaveLength(0);
  });

  it('draws the tile alone with library.art_embedded off, even when a picture is kept', async () => {
    await storeCover();
    setFlags({ 'library.art_embedded': false });
    const { container } = render(<CoverArt seed="Song" songKey={SHA} />);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(images(container)).toHaveLength(0);
    expect(tile(container)).not.toHaveAttribute('data-art');
  });

  it('lays the file\'s own picture over the tile, with an empty alt', async () => {
    await storeCover(40);
    const { container } = render(<CoverArt seed="Song" songKey={SHA} />);
    await waitFor(() => expect(images(container)).toHaveLength(1));
    const [image] = images(container);
    expect(image).toHaveAttribute('alt', '');
    expect(image.getAttribute('src')).toMatch(/^blob:local\//);
    expect(tile(container)).toHaveAttribute('data-art');
    expect(tile(container).style.getPropertyValue('--art-palette-hue')).toBe('40');
    // the tile's own hue is still there underneath
    expect(tile(container).style.getPropertyValue('--art-hue')).not.toBe('');
  });

  it('finds the picture from a song id through the open workspace\'s index', async () => {
    await storeCover();
    bindArtIndex(async (id) => (id === 9 ? SHA : null));
    const { container } = render(<CoverArt seed={9} songId={9} />);
    await waitFor(() => expect(images(container)).toHaveLength(1));
  });

  it('on the hero, shows the small picture while the large one loads', async () => {
    await storeCover();
    const { container } = render(<CoverArt seed="Song" songKey={SHA} size="hero" />);
    await waitFor(() => expect(images(container)).toHaveLength(2));
    expect(images(container).map((image) => image.dataset.layer)).toEqual(['preview', 'full']);
  });

  it('honours a picture passed in from our own origin, with its hue', async () => {
    const { container } = render(<CoverArt seed="Song" artUrl="/api/catalog/art/7/500" artHue={300} />);
    const [image] = images(container);
    expect(image).toHaveAttribute('src', '/api/catalog/art/7/500');
    expect(image).toHaveAttribute('alt', '');
    expect(tile(container).style.getPropertyValue('--art-palette-hue')).toBe('300');
  });

  it('a picture that will not decode leaves the tile', async () => {
    imageApi.decode = () => Promise.reject(new Error('broken'));
    const { container } = render(<CoverArt seed="Song" artUrl="/api/catalog/art/7/500" />);
    await waitFor(() => expect(images(container)).toHaveLength(0));
    expect(tile(container)).toBeInTheDocument();
  });

  it('marks a decoded picture ready', async () => {
    imageApi.decode = () => Promise.resolve();
    const { container } = render(<CoverArt seed="Song" artUrl="/api/catalog/art/7/500" />);
    await waitFor(() => expect(images(container)[0]).toHaveAttribute('data-ready'));
  });
});
