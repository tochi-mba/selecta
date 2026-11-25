import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { resetArtStoreForTests } from './artStore';
import { fakeIndexedDb } from './fakeIndexedDb';
import { bindServerArt, serverArtUrl } from './serverArt';
import { CoverArt } from '../views/CoverArt';

/** ADR-0478 FL-0478-02: in the local app the cover ladder asks this computer's server for a song's
 * own picture; Cloud never binds an address, so it never asks; the flag off draws the tile alone. */

let unbind: () => void = () => undefined;
const images = (container: HTMLElement) => [...container.querySelectorAll<HTMLImageElement>('img')];

beforeEach(() => {
  resetArtStoreForTests();
  vi.stubGlobal('indexedDB', fakeIndexedDb());
});

afterEach(() => {
  unbind();
  unbind = () => undefined;
  resetArtStoreForTests();
});

describe('FL-0478-02 covers served by the local app', () => {
  it('names no address until the local app binds one, and only for real song ids', () => {
    expect(serverArtUrl(3)).toBeNull();
    unbind = bindServerArt((id) => `/api/songs/${id}/art`);
    expect(serverArtUrl(3)).toBe('/api/songs/3/art');
    expect(serverArtUrl(0)).toBeNull();
    expect(serverArtUrl(Number.NaN)).toBeNull();
    expect(serverArtUrl(null)).toBeNull();
    unbind();
    expect(serverArtUrl(3)).toBeNull();
  });

  it('lays the served picture over the tile in the local app', async () => {
    unbind = bindServerArt((id) => `/api/songs/${id}/art`);
    const { container } = render(<CoverArt seed={5} songId={5} />);
    await waitFor(() => expect(images(container)).toHaveLength(1));
    expect(images(container)[0]).toHaveAttribute('src', '/api/songs/5/art');
    expect(images(container)[0]).toHaveAttribute('alt', '');
  });

  it('draws the tile alone with library.art_embedded off', async () => {
    setFlags({ 'library.art_embedded': false });
    unbind = bindServerArt((id) => `/api/songs/${id}/art`);
    const { container } = render(<CoverArt seed={5} songId={5} />);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(images(container)).toHaveLength(0);
    expect(container.querySelector('.cover-art')).not.toHaveAttribute('data-art');
  });

  it('never asks where no address is bound, as in Cloud', async () => {
    const { container } = render(<CoverArt seed={5} songId={5} />);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(images(container)).toHaveLength(0);
  });

  it('a picture passed in still wins over the served one', () => {
    unbind = bindServerArt((id) => `/api/songs/${id}/art`);
    const { container } = render(<CoverArt seed={5} songId={5} artUrl="/api/catalog/art/7/500" />);
    expect(images(container).map((image) => image.getAttribute('src'))).toEqual(['/api/catalog/art/7/500']);
  });
});
