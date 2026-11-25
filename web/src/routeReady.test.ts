import { createElement, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Mix, MyMixes, routeReady, Workshop } from './routeChunks';
import { lazyPage } from './ui/staleBuild';

/** FL-0477-03: a page transition waits a moment for the next page's code, so the new page is
 * captured as itself. `routeReady` says whether there is anything to wait for, and a preloaded
 * page renders without suspending. The split pages are stood in for, so no real page loads here. */

vi.mock('./views/Mix', () => ({ Mix: () => createElement('p', null, 'Editor page') }));
vi.mock('./views/MyMixes', () => ({ MyMixes: () => createElement('p', null, 'My Mixes page') }));
vi.mock('./views/Links', () => ({ Links: () => createElement('p', null, 'Discover page') }));
vi.mock('./views/Workshop', () => ({ Workshop: () => createElement('p', null, 'Workshop page') }));

describe('FL-0477-03 routeReady', () => {
  it('is null for a page that is not split out', () => {
    for (const path of ['/', '/listen', '/library', '/mixes', '/listening', '/nowhere']) expect(routeReady(path), path).toBeNull();
  });

  it('is a promise for a split page not loaded yet, then null once it has arrived', async () => {
    expect(MyMixes.loaded()).toBe(false);
    const waiting = routeReady('/mixes/mine?sort=new');
    expect(waiting).toBeInstanceOf(Promise);
    await waiting;
    expect(MyMixes.loaded()).toBe(true);
    expect(routeReady('/mixes/mine')).toBeNull();
    // the older address of the same page is the same chunk
    expect(routeReady('/my-mixes')).toBeNull();
  });

  it('knows each split page by its addresses and their aliases', async () => {
    expect(routeReady('/mixes/drafts/12/edit')).toBeInstanceOf(Promise);
    await routeReady('/mix/current/edit');
    expect(Mix.loaded()).toBe(true);
    const workshop = routeReady('/workspace/storage');
    expect(workshop).toBeInstanceOf(Promise);
    await workshop;
    expect(Workshop.loaded()).toBe(true);
    expect(routeReady('/workshop')).toBeNull();
    const discover = routeReady('/explore/harmonic');
    expect(discover).toBeInstanceOf(Promise);
    await discover;
    expect(routeReady('/discover')).toBeNull();
  });
});

describe('FL-0477-03 lazyPage', () => {
  it('after preload() a render does not suspend', async () => {
    const Page = lazyPage(async () => ({ default: () => createElement('p', null, 'Arrived') }));
    await Page.preload();
    expect(Page.loaded()).toBe(true);
    render(createElement(Suspense, { fallback: createElement('p', null, 'Loading') }, createElement(Page)));
    // synchronously, with no waiting: the page itself, never its fallback
    expect(screen.getByText('Arrived')).toBeInTheDocument();
    expect(screen.queryByText('Loading')).toBeNull();
  });

  it('without a preload the first render waits on the fallback', async () => {
    const Page = lazyPage(async () => ({ default: () => createElement('p', null, 'Arrived late') }));
    render(createElement(Suspense, { fallback: createElement('p', null, 'Loading') }, createElement(Page)));
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(await screen.findByText('Arrived late')).toBeInTheDocument();
  });

  it('preload never rejects, even when the code cannot be fetched', async () => {
    const Page = lazyPage(() => Promise.reject(new Error('boom')));
    await expect(Page.preload()).resolves.toBeUndefined();
    expect(Page.loaded()).toBe(false);
  });
});
