import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetArtStoreForTests } from './artStore';
import { fakeIndexedDb } from './fakeIndexedDb';
import { bindServerArt, resetServerArtForTests } from './serverArt';
import { CoverArt } from '../views/CoverArt';

/** T-20261125-4054: in the local app a served cover is fetched once and redrawn at display size
 * (first frame only) before it is shown, so the full picture never sits in a Library row. */

const made = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./artWorker', async (original) => ({
  ...(await original<typeof import('./artWorker')>()),
  artSupported: () => true,
  makeArt: async () => {
    made.calls += 1;
    return { small: new Blob(['s']), large: new Blob(['l']), hue: null };
  },
}));

let unbind: () => void = () => undefined;
const images = (container: HTMLElement) => [...container.querySelectorAll<HTMLImageElement>('img')];

beforeEach(() => {
  resetArtStoreForTests();
  resetServerArtForTests();
  made.calls = 0;
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  let next = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:redrawn-${(next += 1)}`, revokeObjectURL: () => undefined }));
});

afterEach(() => {
  unbind();
  unbind = () => undefined;
  resetServerArtForTests();
  vi.unstubAllGlobals();
});

describe('local covers are redrawn at display size', () => {
  it('shows the redrawn copy, never the served address, and fetches once for many rows', async () => {
    const fetched = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetched);
    unbind = bindServerArt((id) => `/api/songs/${id}/art`);
    const { container } = render(<><CoverArt seed={5} songId={5} /><CoverArt seed={5} songId={5} /></>);
    await waitFor(() => expect(images(container)).toHaveLength(2));
    expect(images(container).every((image) => image.getAttribute('src')?.startsWith('blob:redrawn-'))).toBe(true);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(made.calls).toBe(1);
  });

  it('keeps the tile for a song with no picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    unbind = bindServerArt((id) => `/api/songs/${id}/art`);
    const { container } = render(<CoverArt seed={6} songId={6} />);
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    expect(images(container)).toHaveLength(0);
    expect(made.calls).toBe(0);
  });
});
