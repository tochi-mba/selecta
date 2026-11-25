import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Section } from './controls';
import { isChunkLoadError, lazyPage, SlowToArrive } from './staleBuild';

const gone = () => new TypeError('Failed to fetch dynamically imported module: https://selectadj.app/assets/Mix-abc123.js');

describe('a deploy under an open tab (gap 4)', () => {
  it('a page whose code never arrives offers Reload after the limit, not before', async () => {
    const Page = lazyPage(() => new Promise<never>(() => undefined));
    render(<Suspense fallback={<p>Loading<SlowToArrive ms={20} /></p>}><Page /></Suspense>);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Reload' }, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/anything playing keeps playing/)).toBeTruthy();
  });

  it('knows a missing page file from any other error', () => {
    expect(isChunkLoadError(gone())).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('x is not a function'))).toBe(false);
  });

  it('tries a failed page file once more and opens it when the retry works', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(gone())
      .mockResolvedValueOnce({ default: () => <p>The page</p> });
    const Page = lazyPage(load);
    render(<Suspense fallback={<p>Loading</p>}><Page /></Suspense>);
    expect(await screen.findByText('The page', {}, { timeout: 3000 })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says SelectaDJ has been updated, with Reload, when the page file is gone for good', async () => {
    const Page = lazyPage(() => Promise.reject(gone()));
    render(<Suspense fallback={<p>Loading</p>}><Page /></Suspense>);
    expect(await screen.findByText('SelectaDJ has been updated.', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});

describe('a page that stops drawing (gap 5)', () => {
  function Broken(): never {
    throw new Error('secret stack detail');
  }

  it('offers Try again, Reload and support with a reference, and never shows the error', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<div><p>The player</p><Section name="Library"><Broken /></Section></div>);
    expect(screen.getByText('Library stopped working.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    const support = screen.getByRole('link', { name: 'Contact support' }).getAttribute('href') ?? '';
    const reference = screen.getByText(/^R-[A-Z0-9]{4}-[A-Z0-9]{4}$/).textContent ?? '';
    expect(decodeURIComponent(support)).toContain(`Reference: ${reference}`);
    expect(document.body.textContent).not.toContain('secret stack detail');
    // whatever lives above the frame (the player) is still there
    expect(screen.getByText('The player')).toBeTruthy();
    quiet.mockRestore();
  });
});
