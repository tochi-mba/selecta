import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { putArt, resetArtStoreForTests } from '../media/artStore';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { CoverArt } from './CoverArt';
import { MixArt } from './MixArt';

/** FL-0478-05: a saved mix's face. With the art flag and every feel flag off it is exactly the
 * tile it replaced; with art on it is a collage of its first songs' covers. */

const ALL_OFF = {
  'library.art_embedded': false,
  'app.feel_motion': false, 'app.feel_depth': false, 'app.feel_pointer_light': false,
  'app.feel_music': false, 'app.feel_ambient': false, 'app.feel_moments': false,
};
const SHA = 'e'.repeat(64);
const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
const songs = [{ song_id: 1, sha256: SHA }, { song_id: 2 }, { song_id: 3 }, { song_id: 4 }, { song_id: 5 }];

beforeEach(() => {
  resetArtStoreForTests();
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  urlApi.createObjectURL = vi.fn(() => 'blob:local/face');
  urlApi.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetArtStoreForTests();
  delete urlApi.createObjectURL;
  delete urlApi.revokeObjectURL;
});

describe('FL-0478-05 MixArt', () => {
  it('is exactly the plain tile with every flag off', () => {
    setFlags(ALL_OFF);
    const face = render(<MixArt seed="mix-1" songs={songs} travels />);
    const plain = render(<CoverArt seed="mix-1" />);
    expect(face.container.innerHTML).toBe(plain.container.innerHTML);
    expect(face.container.querySelector('.mix-art')).toBeNull();
  });

  it('is a collage of the first four songs\' covers, each over its own tile', async () => {
    await putArt(SHA, { small: new Blob(['s'], { type: 'image/webp' }), large: new Blob(['l'], { type: 'image/webp' }), hue: 10 });
    const { container } = render(<MixArt seed="mix-1" songs={songs} />);
    const face = container.querySelector<HTMLElement>('.mix-art')!;
    expect(face).toHaveAttribute('aria-hidden', 'true');
    expect(face).toHaveAttribute('data-collage', '4');
    expect(face.querySelectorAll('.cover-art')).toHaveLength(4);
    await waitFor(() => expect(face.querySelectorAll('img')).toHaveLength(1));
    expect(face.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('keeps the single tile until the mix\'s songs are known, or with art off', () => {
    const unknown = render(<MixArt seed="mix-1" />);
    expect(unknown.container.querySelectorAll('.cover-art')).toHaveLength(1);
    unknown.unmount();
    setFlags({ 'library.art_embedded': false });
    const { container } = render(<MixArt seed="mix-1" songs={songs} />);
    expect(container.querySelector('.mix-art')).not.toBeNull();
    expect(container.querySelectorAll('.cover-art')).toHaveLength(1);
  });

  it('carries the shared name only when it travels', () => {
    const still = render(<MixArt seed="mix-1" songs={songs} />);
    expect(still.container.querySelector('.mix-art')).not.toHaveAttribute('data-vt');
    still.unmount();
    const travelling = render(<MixArt seed="mix-1" songs={songs} travels />);
    expect(travelling.container.querySelector('.mix-art')).toHaveAttribute('data-vt', 'mix-art');
  });
});
